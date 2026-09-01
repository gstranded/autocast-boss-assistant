import { MSG } from '../shared/messaging.js';
import {
  appendHistory,
  appendLog,
  bumpDailyStat,
  clearHistory,
  clearLogs,
  exportAll,
  getAllConfig,
  getHistory,
  getIdempotencyMap,
  getTodayStats,
  hasIdempotent,
  importAll,
  markIdempotent,
  saveBindings,
  saveFilters,
  saveLists,
  saveMessageTemplate,
  saveResumes,
  saveSettings,
  saveTask
} from '../shared/storage.js';
import {
  evaluateJob,
  matchActive,
  normalizeActiveWithin,
  summarizePreview,
  looksHunter
} from '../shared/filter-engine.js';
import { checkDedup, checkLimits, jobIdempotencyKey, resumeIdempotencyKey } from '../shared/dedup.js';
import { planMessageSegments } from '../shared/message-planner.js';
import {
  NATIVE_GREETING_STATES,
  resolveNativeGreetingEvidence
} from '../shared/greeting-policy.js';
import { pickResumeProfile } from '../shared/template.js';
import { planResumeSend } from '../shared/resume-policy.js';
import { REASON, reasonText } from '../shared/reason-codes.js';
import { TASK_STATUS } from '../shared/constants.js';
import { isBossUrl, isBossTab, bossUrlGuardMessage, BOSS_MATCH_PATTERNS } from '../shared/boss-url.js';
import { didContentDocumentChange, isBossJobListUrl, resolveBossJobListUrl } from '../shared/job-list-navigation.js';
import { normalizeMatchText, normalizeText, randomBetween, sleep, uid } from '../shared/text-utils.js';
import { computeSideBySideBounds } from '../shared/window-layout.js';
import { dedupeResumeImages } from '../shared/resume-images.js';
import { pickNextTestDeliveryJob } from '../shared/test-delivery.js';
import {
  buildConversationWorkerAttempts,
  CONVERSATION_WORKER_MODE,
  isListDocumentPreserved
} from '../shared/conversation-worker.js';
import {
  buildDeliveryQueue,
  collectDoneJobIds,
  taskCounterSnapshot
} from '../shared/task-model.js';
import { createOperationRegistry } from './operation-registry.js';
import {
  appendSessionDebugLog,
  getSessionDebugLogs,
  sanitizeDebugValue
} from '../shared/debug-log.js';
import {
  isScanResultWithinFinalizationWindow,
  OPERATION_TIMEOUTS,
  resolveBridgeTimeoutMs,
  resolvePageOperationTimeoutMs
} from '../shared/operation-timeouts.js';
import {
  normalizePreviewScanTerminalState,
  PREVIEW_SCAN_STOP,
  resolvePreviewScanStop
} from '../shared/preview-scan-policy.js';

const SPLIT_ZOOM_FACTOR = 0.8;
const BHT_RUNTIME_VERSION = String(chrome.runtime.getManifest?.().version || 'unknown');
const VERSION_GUARDED_MESSAGES = new Set([
  MSG.RUN_PREVIEW,
  MSG.CONFIRM_AND_START,
  MSG.RUN_TEST_DELIVERY,
  'BHT_RUN_TEST_DELIVERY',
  MSG.RESUME_TASK
]);
const JOB_PHASE = Object.freeze({
  CHAT_TRIGGERED: 'CHAT_TRIGGERED',
  CONVERSATION_OPENED: 'CONVERSATION_OPENED',
  CONVERSATION_OPENED_EDITOR_PENDING: 'CONVERSATION_OPENED_EDITOR_PENDING'
});

function hasChatCheckpoint(item) {
  return [
    JOB_PHASE.CHAT_TRIGGERED,
    JOB_PHASE.CONVERSATION_OPENED,
    JOB_PHASE.CONVERSATION_OPENED_EDITOR_PENDING
  ].includes(item?.phase);
}

let runner = {
  running: false,
  starting: false,
  previewing: false,
  previewRunId: '',
  previewStartedAt: 0,
  previewScanStartedAt: 0,
  previewScanFinishedAt: 0,
  previewPhase: '',
  previewScanned: 0,
  previewPass: 0,
  previewPreviousTask: null,
  abort: false,
  pause: false,
  skipCurrent: false,
  pauseLogged: false
};
const operations = createOperationRegistry();
let debugLoggingEnabled = false;
let activePreviewRun = null;

function cloneTaskSnapshot(task) {
  if (!task || typeof task !== 'object') return null;
  try {
    return structuredClone(task);
  } catch (_) {
    try { return JSON.parse(JSON.stringify(task)); } catch (_) { return null; }
  }
}

async function syncDebugLoggingSetting(settings = null) {
  try {
    const next = settings || (await getAllConfig()).settings || {};
    debugLoggingEnabled = next.debugLoggingEnabled === true;
  } catch (_) {
    debugLoggingEnabled = false;
  }
  return debugLoggingEnabled;
}

async function debugLog(scope, event, data = {}, level = 'debug') {
  if (!debugLoggingEnabled) return null;
  return appendSessionDebugLog({
    ts: Date.now(),
    level,
    scope,
    event,
    taskId: data?.taskId || null,
    data: sanitizeDebugValue(data)
  });
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: String(error.name || 'Error'),
    message: String(error.message || error),
    code: error.code || '',
    stack: String(error.stack || '').slice(0, 8000)
  };
}

function summarizeBossOperationResult(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    ok: result.ok === true,
    error: result.error || '',
    message: result.message || '',
    count: Number(result.count || 0),
    contentVersion: result.contentVersion || '',
    scanMeta: result.scanMeta || null,
    receipt: result.receipt ? {
      type: result.receipt.type || '',
      status: result.receipt.status || '',
      receiptId: result.receipt.receiptId || ''
    } : null
  };
}

function runnerIsBusy() {
  return runner.running || runner.starting || runner.previewing;
}

function isPreviewRunActive(runId = '') {
  return Boolean(runner.previewing && (!runId || runner.previewRunId === runId));
}

function previewCancelledResult() {
  return { ok: false, error: 'OP_CANCELLED', message: '已取消本次扫描预览' };
}

function setPreviewPhase(phase, runId = '') {
  if (!isPreviewRunActive(runId)) return;
  runner.previewPhase = String(phase || '');
}

function setPreviewProgress(scanned = 0, pass = 0, runId = '') {
  if (!isPreviewRunActive(runId)) return;
  runner.previewScanned = Math.max(0, Number(scanned || 0));
  runner.previewPass = Math.max(0, Number(pass || 0));
}

function runnerSnapshot() {
  return {
    running: runner.running && !runner.abort,
    starting: runner.starting,
    previewing: runner.previewing,
    previewStartedAt: runner.previewStartedAt || 0,
    previewScanStartedAt: runner.previewScanStartedAt || 0,
    previewScanFinishedAt: runner.previewScanFinishedAt || 0,
    previewPhase: runner.previewPhase || '',
    previewScanned: runner.previewScanned || 0,
    previewPass: runner.previewPass || 0,
    pause: runner.pause && !runner.abort,
    stopping: runner.running && runner.abort,
    activeOperations: operations.size
  };
}

async function discardCancelledPreviewTask(previewRunId, previousTask = null) {
  if (!previewRunId) return false;
  let current = null;
  try {
    current = (await getAllConfig()).task;
  } catch (_) {
    return false;
  }
  if (String(current?.previewRunId || '') !== String(previewRunId)) return false;

  const restored = cloneTaskSnapshot(previousTask);
  if (restored) {
    restored.updatedAt = Date.now();
    delete restored.previewRunId;
    await saveTask(restored);
  } else {
    await saveTask(null);
  }
  try {
    chrome.runtime.sendMessage({
      type: MSG.TASK_EVENT,
      payload: restored,
      authoritative: true,
      reason: 'preview_cancel_rollback'
    }).catch(() => {});
  } catch (_) {}
  await debugLog('background.preview', 'discard_cancelled_publish', {
    previewRunId,
    restoredTaskId: restored?.id || null
  }, 'warn');
  return true;
}

async function publishPreviewTask(task, previewRunId, previousTask = null) {
  if (!isPreviewRunActive(previewRunId)) return false;
  // Mark the candidate so STOP_TASK can distinguish a late preview write from
  // a task that was created before this scan started.
  task.previewRunId = previewRunId;
  await publishTask(task);
  if (!isPreviewRunActive(previewRunId)) {
    await discardCancelledPreviewTask(previewRunId, previousTask);
    return false;
  }
  return true;
}

async function withRunnerAdmission(kind, action) {
  if (runnerIsBusy()) {
    await debugLog('background.runner', 'admission_rejected', {
      requested: kind,
      running: runner.running,
      starting: runner.starting,
      previewing: runner.previewing
    }, 'warn');
    return {
      ok: false,
      error: 'ALREADY_RUNNING',
      message: runner.previewing
        ? '正在扫描预览，请等待扫描完成后再投递'
        : '当前已有任务正在启动或执行，请勿重复点击'
    };
  }
  const admissionId = kind === 'previewing' ? uid('preview') : '';
  runner[kind] = true;
  if (kind === 'previewing') {
    // runner 已通过空闲门禁；此时的 pause/abort/skip 只能来自上一轮残留。
    runner.pause = false;
    runner.abort = false;
    runner.skipCurrent = false;
    runner.previewRunId = admissionId;
    runner.previewStartedAt = Date.now();
    runner.previewScanStartedAt = 0;
    runner.previewScanFinishedAt = 0;
    runner.previewPhase = 'locating_list';
    runner.previewScanned = 0;
    runner.previewPass = 0;
    runner.previewPreviousTask = null;
  }
  await debugLog('background.runner', 'admission_acquired', { kind });
  let actionPromise = null;
  try {
    actionPromise = Promise.resolve().then(() => action(admissionId));
    if (kind === 'previewing') activePreviewRun = { id: admissionId, promise: actionPromise };
    return await actionPromise;
  } finally {
    if (kind === 'previewing' && activePreviewRun?.id === admissionId) activePreviewRun = null;
    const ownsAdmission = kind !== 'previewing' || runner.previewRunId === admissionId;
    if (ownsAdmission) {
      runner[kind] = false;
      if (kind === 'previewing') {
        runner.previewStartedAt = 0;
        runner.previewScanStartedAt = 0;
        runner.previewScanFinishedAt = 0;
        runner.previewPhase = '';
        runner.previewScanned = 0;
        runner.previewPass = 0;
        runner.previewRunId = '';
        runner.previewPreviousTask = null;
      }
    }
    await debugLog('background.runner', 'admission_released', { kind });
  }
}

function cancelledResult() {
  return { ok: false, error: 'OP_CANCELLED', message: '任务已停止，页面操作已取消' };
}

async function cancelActiveOperations(reason = '任务已停止') {
  const active = operations.clear();
  await debugLog('background.operation', 'cancel_all', { reason, active });
  await Promise.all(active.map((operation) => cancelBridgeOperation({ ...operation, reason })));
  return active.length;
}

function scheduleBridgeStorageCleanup(storageKey, delayMs = 60000) {
  if (!storageKey) return;
  setTimeout(() => {
    chrome.storage.local.remove(storageKey).catch(() => {});
  }, Math.max(1000, Number(delayMs) || 60000));
}

// Cancellation must outlive the background poller: the page may still hold the
// operation lock while it unwinds a sleep/DOM wait. Keep a tombstone until the
// content script confirms that its finally block has run.
async function requestBridgeCancellation({ opId, tabId, storageKey, reason = '任务已停止' } = {}) {
  if (!opId && !storageKey) return false;
  const key = storageKey || `bht_op_${opId}`;
  try {
    await chrome.storage.local.set({
      [key]: {
        status: 'cancelled',
        opId: opId || '',
        reason,
        at: Date.now(),
        cancelRequestedAt: Date.now(),
        settled: false
      }
    });
  } catch (_) {}
  try {
    if (tabId != null && opId) {
      await chrome.tabs.sendMessage(tabId, {
        type: MSG.CANCEL_OP,
        payload: { opId, reason }
      });
    }
  } catch (_) {}
  return true;
}

async function waitForBridgeCancellationSettlement({ opId, storageKey, reason = '任务已停止' } = {}) {
  const key = storageKey || (opId ? `bht_op_${opId}` : '');
  if (!key) return false;

  const deadline = Date.now() + OPERATION_TIMEOUTS.BRIDGE_CANCEL_SETTLE_MS;
  let settled = false;
  while (Date.now() < deadline) {
    await sleep(OPERATION_TIMEOUTS.BRIDGE_CANCEL_POLL_MS);
    try {
      const bag = await chrome.storage.local.get(key);
      const row = bag?.[key];
      if (row?.status === 'done' || (row?.status === 'cancelled' && row.settled === true)) {
        settled = true;
        break;
      }
    } catch (_) {}
  }
  if (settled) {
    try { await chrome.storage.local.remove(key); } catch (_) {}
  } else {
    try {
      await chrome.storage.local.set({
        [key]: {
          status: 'cancelled',
          opId: opId || '',
          reason,
          at: Date.now(),
          cancelRequestedAt: Date.now(),
          settled: false,
          expiresAt: Date.now() + 60000
        }
      });
    } catch (_) {}
    scheduleBridgeStorageCleanup(key);
  }
  return settled;
}

async function cancelBridgeOperation(operation = {}) {
  await requestBridgeCancellation(operation);
  return waitForBridgeCancellationSettlement(operation);
}

async function reconcileStaleRunningTask(reason = '扩展后台已重启') {
  try {
    const all = await getAllConfig();
    const task = all.task;
    if (!task) return;
    if (task.execution?.workerTabId) {
      await closeConversationWorkerTab(task, task.execution.workerTabId, {
        reason: '扩展后台重启，清理遗留沟通执行页'
      });
    }
    const legacyResumeProtocolFailure = /(?:附件简历|BOSS\s*在线简历).*UNKNOWN_TYPE/i.test(
      [task.pauseReason || '', task.lastErrorDetail || '', ...(task.items || []).flatMap((item) => item.reasons || [])].join(' ')
    );
    if (legacyResumeProtocolFailure) {
      const recoveryMessage = '检测到旧版本后台残留的 BOSS 在线简历协议；该协议已移除。请点「重试」，插件会依据已发送回执跳过文字/图片并完成当前岗位';
      task.status = TASK_STATUS.PAUSED;
      task.pauseReason = recoveryMessage;
      task.lastErrorDetail = recoveryMessage;
      task.awaitingUserRetry = true;
      task.uiErrorDismissed = false;
      task.items = (task.items || []).map((item) => {
        const hit = /(?:附件简历|BOSS\s*在线简历).*UNKNOWN_TYPE/i.test((item.reasons || []).join(' '));
        return hit ? { ...item, reasons: [recoveryMessage] } : item;
      });
      task.updatedAt = Date.now();
      await publishTask(task);
      await log('warn', recoveryMessage, { taskId: task.id || null, legacyProtocol: 'BHT_SEND_RESUME' });
      return;
    }
    if (task.status === TASK_STATUS.RUNNING) {
      task.status = TASK_STATUS.PAUSED;
      task.pauseReason = reason + '，任务已安全暂停。请确认页面后点「继续」恢复队列。';
      task.updatedAt = Date.now();
      await publishTask(task);
      await log('warn', task.pauseReason, { taskId: task.id || null });
    }
  } catch (_) {}
}

async function clearStaleOperationArtifacts() {
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all || {}).filter((key) => key.startsWith('bht_op_'));
    if (keys.length) await chrome.storage.local.remove(keys);
    return keys.length;
  } catch (_) {
    return 0;
  }
}

async function recoverBackgroundState(reason) {
  await syncDebugLoggingSetting();
  await clearStaleOperationArtifacts();
  await reconcileStaleRunningTask(reason);
}

// MV3 service worker 冷启动时内存 runner 为空；避免 storage 仍显示 running 造成假运行
recoverBackgroundState('扩展后台已重启').catch(() => {});

chrome.runtime.onStartup?.addListener(() => {
  recoverBackgroundState('浏览器启动后扩展后台已重建').catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  await getAllConfig();
  await recoverBackgroundState('扩展更新/重载后后台已重建');
  // side panel disabled: using floating panel + action popup
  await refreshSidePanelForAllTabs();
});

async function setSidePanelForTab(tabId, url) {
  if (!chrome.sidePanel?.setOptions || tabId == null) return;
  const enabled = isBossUrl(url || "");
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel/index.html",
      enabled
    });
  } catch (_) {}
}

async function refreshSidePanelForAllTabs() {
  if (!chrome.sidePanel?.setOptions) return;
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((t) => setSidePanelForTab(t.id, t.url || "")));
  } catch (_) {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    setSidePanelForTab(tabId, changeInfo.url || tab?.url || "");
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setSidePanelForTab(tabId, tab?.url || "");
  } catch (_) {}
});

chrome.action?.onClicked?.addListener(async (tab) => {
  if (!isBossTab(tab)) {
    try {
      if (tab?.id != null) await setSidePanelForTab(tab.id, tab.url || "");
    } catch (_) {}
    return;
  }
  if (chrome.sidePanel?.open && tab?.windowId != null) {
    await setSidePanelForTab(tab.id, tab.url || "");
    await chrome.sidePanel.open({ windowId: tab.windowId, tabId: tab.id });
  }
});

async function tabFromSender(sender) {
  const raw = sender?.tab;
  if (!raw?.id) return null;
  try {
    const live = await chrome.tabs.get(raw.id);
    return live || raw;
  } catch (_) {
    return raw;
  }
}

async function getActiveBossTab({ allowInactiveBossTab = false, sender = null } = {}) {
  const fromSender = await tabFromSender(sender);
  if (isBossTab(fromSender)) return fromSender;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (isBossTab(active)) return active;

  // 严格模式：当前激活页不是 BOSS 时，默认不跨标签操作
  if (!allowInactiveBossTab) return null;

  const all = await chrome.tabs.query({ url: BOSS_MATCH_PATTERNS });
  return all.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

function deadlineReached(deadlineAt, now = Date.now()) {
  const deadline = Number(deadlineAt || 0);
  return Number.isFinite(deadline) && deadline > 0 && Number(now) >= deadline;
}

function remainingDeadlineMs(deadlineAt, capMs, now = Date.now()) {
  const cap = Math.max(0, Number(capMs) || 0);
  const deadline = Number(deadlineAt || 0);
  if (!Number.isFinite(deadline) || deadline <= 0) return cap;
  return Math.max(0, Math.min(cap, deadline - Number(now)));
}

async function sleepWithinDeadline(waitMs, deadlineAt = 0) {
  const boundedWaitMs = remainingDeadlineMs(deadlineAt, waitMs);
  if (deadlineAt && boundedWaitMs <= 0) return false;
  await sleep(boundedWaitMs);
  return !deadlineReached(deadlineAt);
}

function previewScanDeadlineResult(extra = {}) {
  return {
    ok: false,
    error: 'OP_DEADLINE_EXCEEDED',
    message: '岗位加载时间已结束，开始筛选已收集岗位',
    ...extra
  };
}

async function forceInjectContent(tabId, { deadlineAt = 0 } = {}) {
  if (deadlineReached(deadlineAt)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/page-network-hook.js"],
      world: "MAIN",
      injectImmediately: true
    });
  } catch (_) {
    // 受限页面可能拒绝 MAIN world；隔离世界仍可继续走设置与 DOM 兜底。
  }
  if (deadlineReached(deadlineAt)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "shared/trigger-navigation-recovery.js",
        "shared/conversation-match.js",
        "shared/operation-dispatch-gate.js",
        "content/content-main.js"
      ],
      injectImmediately: true
    });
    return await sleepWithinDeadline(120, deadlineAt);
  } catch (_) {
    return false;
  }
}



async function waitTabComplete(tabId, timeoutMs = 45000, {
  shouldStop = null,
  requireComplete = false,
  deadlineAt = 0
} = {}) {
  const start = Date.now();
  const timeoutDeadlineAt = start + Math.max(0, Number(timeoutMs) || 0);
  const waitDeadlineAt = Number(deadlineAt) > 0
    ? Math.min(timeoutDeadlineAt, Number(deadlineAt))
    : timeoutDeadlineAt;
  let lastUrl = "";
  let stableSince = 0;
  while (Date.now() < waitDeadlineAt) {
    if (typeof shouldStop === 'function' && shouldStop()) return null;
    try {
      const t = await chrome.tabs.get(tabId);
      const url = t.url || t.pendingUrl || "";
      if (t.status === "complete" && isBossUrl(url)) {
        if (url === lastUrl) {
          if (!stableSince) stableSince = Date.now();
          // URL 稳定 800ms 再返回，避免 SPA 中间态
          if (Date.now() - stableSince >= 800) return t;
        } else {
          lastUrl = url;
          stableSince = Date.now();
        }
      }
    } catch (e) {
      return null;
    }
    const remainingMs = Math.max(0, waitDeadlineAt - Date.now());
    if (remainingMs <= 0) break;
    await sleep(Math.min(200, remainingMs));
  }
  if (requireComplete) return null;
  try { return await chrome.tabs.get(tabId); } catch (_) { return null; }
}

async function getDisplayMetrics(tabId) {
  try {
    const rows = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        left: window.screen.availLeft,
        top: window.screen.availTop,
        width: window.screen.availWidth,
        height: window.screen.availHeight
      })
    });
    return rows?.[0]?.result || null;
  } catch (_) {
    return null;
  }
}

async function setNormalWindowBounds(windowId, bounds) {
  await chrome.windows.update(windowId, { state: 'normal' });
  return chrome.windows.update(windowId, {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height
  });
}

async function setSplitTabZoom(tabId) {
  if (tabId == null || !chrome.tabs?.setZoom) return false;
  try {
    if (chrome.tabs.setZoomSettings) {
      await chrome.tabs.setZoomSettings(tabId, {
        mode: 'automatic',
        scope: 'per-tab'
      });
    }
    await chrome.tabs.setZoom(tabId, SPLIT_ZOOM_FACTOR);
    return true;
  } catch (_) {
    return false;
  }
}

// 分屏窗口可能因创建时未聚焦而被系统隐藏或最小化（坐标更新无效、state 更新有效）。
// 显式恢复 normal 并依次前置：先消息窗后列表窗；两窗不重叠，前置后左右都可见。
async function raiseSplitWindows(listWindowId, messageWindowId) {
  if (messageWindowId != null) {
    await chrome.windows.update(messageWindowId, { state: 'normal' }).catch(() => {});
    await chrome.windows.update(messageWindowId, { focused: true }).catch(() => {});
  }
  if (listWindowId != null) {
    await chrome.windows.update(listWindowId, { state: 'normal' }).catch(() => {});
    await chrome.windows.update(listWindowId, { focused: true }).catch(() => {});
  }
}

export async function prepareSplitWorkspace(task, settings = {}) {
  if (!task.execution) task.execution = {};
  if (settings.splitViewEnabled === false) {
    task.execution.splitViewActive = false;
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  const listTab = task.execution.listTabId
    ? await chrome.tabs.get(task.execution.listTabId).catch(() => null)
    : await getActiveBossTab({ allowInactiveBossTab: false });
  if (!listTab?.id || !isBossTab(listTab)) {
    task.execution.splitViewActive = false;
    return { ok: false, error: 'LIST_TAB_NOT_FOUND', message: '未找到当前职位列表页，无法自动分屏' };
  }

  task.execution.listTabId = listTab.id;
  const display = await getDisplayMetrics(listTab.id);
  const bounds = computeSideBySideBounds(display || {}, { minWidth: 520, minHeight: 600 });
  if (!bounds) {
    task.execution.splitViewActive = false;
    return { ok: false, error: 'DISPLAY_TOO_SMALL', message: '当前屏幕空间不足，已回退为普通消息标签页' };
  }

  // 1) 复用上一对分屏窗口：两个窗口和对应标签都在就只做尽力摆放，不再新建窗口
  if (task.execution.splitViewActive && task.execution.listWindowId && task.execution.messageWindowId) {
    const prevListWin = await chrome.windows.get(task.execution.listWindowId).catch(() => null);
    const prevMsgWin = await chrome.windows.get(task.execution.messageWindowId).catch(() => null);
    const listTabNow = await chrome.tabs.get(task.execution.listTabId).catch(() => null);
    const msgTabNow = await chrome.tabs.get(task.execution.messageTabId).catch(() => null);
    if (
      prevListWin && prevMsgWin && listTabNow && msgTabNow &&
      listTabNow.windowId === prevListWin.id && msgTabNow.windowId === prevMsgWin.id
    ) {
      // 部分平台 windows.update 会静默忽略坐标，失败不影响已有窗口位置
      await setNormalWindowBounds(prevListWin.id, bounds.left).catch(() => {});
      await setNormalWindowBounds(prevMsgWin.id, bounds.right).catch(() => {});
      task.execution.splitBounds = bounds;
      task.execution.phase = 'SPLIT_WORKSPACE_READY';
      await chrome.tabs.update(listTab.id, { active: true }).catch(() => {});
      await raiseSplitWindows(prevListWin.id, prevMsgWin.id);
      await debugLog('background.split', 'pair_reused', {
        listWindowId: prevListWin.id,
        messageWindowId: prevMsgWin.id,
        bounds
      });
      return {
        ok: true,
        reused: true,
        listTabId: listTab.id,
        messageTabId: msgTabNow.id,
        bounds,
        zoomFactor: SPLIT_ZOOM_FACTOR,
        zoomApplied: false
      };
    }
  }

  try {
    // 2) 左窗：把职位列表标签搬进按左半边创建的新窗口。
    //    create({ tabId }) 在 windows.update 不生效的平台上也可靠，位置由创建参数保证。
    const listWindow = await chrome.windows.create({
      tabId: listTab.id,
      type: 'normal',
      focused: false,
      ...bounds.left
    });
    const listWindowId = listWindow.id;
    task.execution.listWindowId = listWindowId;

    // 3) 右窗：优先找现有聊天标签搬过去，没有就新建聊天窗口
    const savedMsgTab = task.execution.messageTabId
      ? await chrome.tabs.get(task.execution.messageTabId).catch(() => null)
      : null;
    let messageTab = savedMsgTab && savedMsgTab.windowId !== listWindowId ? savedMsgTab : null;
    if (!messageTab?.id) {
      const bossTabs = await chrome.tabs.query({ url: BOSS_MATCH_PATTERNS });
      messageTab = bossTabs.find(
        (tab) => tab.id !== listTab.id && tab.windowId !== listWindowId && /\/chat/i.test(tab.url || tab.pendingUrl || '')
      ) || null;
    }

    let messageWindow;
    if (messageTab?.id) {
      messageWindow = await chrome.windows.create({
        tabId: messageTab.id,
        type: 'normal',
        focused: false,
        ...bounds.right
      });
      messageTab = messageWindow.tabs?.[0] || await chrome.tabs.get(messageTab.id);
    } else {
      messageWindow = await chrome.windows.create({
        url: 'https://www.zhipin.com/web/geek/chat',
        type: 'normal',
        focused: false,
        ...bounds.right
      });
      messageTab = messageWindow.tabs?.[0] || (await chrome.tabs.query({ windowId: messageWindow.id }))[0] || null;
    }

    if (!messageTab?.id) throw new Error('消息窗口已创建，但未获得标签页');
    task.execution.messageTabId = messageTab.id;
    task.execution.messageWindowId = messageWindow.id;
    if (!/\/chat/i.test(messageTab.url || messageTab.pendingUrl || '')) {
      messageTab = await chrome.tabs.update(messageTab.id, {
        url: 'https://www.zhipin.com/web/geek/chat',
        active: true
      });
    }
    await waitTabComplete(messageTab.id, 25000);
    const zoomApplied = await Promise.all([
      setSplitTabZoom(listTab.id),
      setSplitTabZoom(messageTab.id)
    ]);
    await forceInjectContent(messageTab.id);

    task.execution.splitViewActive = true;
    task.execution.splitBounds = bounds;
    task.execution.splitZoomFactor = SPLIT_ZOOM_FACTOR;
    task.execution.splitZoomApplied = zoomApplied.every(Boolean);
    task.execution.phase = 'SPLIT_WORKSPACE_READY';

    await chrome.tabs.update(listTab.id, { active: true }).catch(() => {});
    await raiseSplitWindows(listWindowId, messageWindow.id);
    const listWinState = await chrome.windows.get(listWindowId).catch(() => null);
    const msgWinState = await chrome.windows.get(messageWindow.id).catch(() => null);
    await debugLog('background.split', 'windows_state', {
      list: listWinState ? { id: listWinState.id, state: listWinState.state, left: listWinState.left, top: listWinState.top, width: listWinState.width, height: listWinState.height } : null,
      message: msgWinState ? { id: msgWinState.id, state: msgWinState.state, left: msgWinState.left, top: msgWinState.top, width: msgWinState.width, height: msgWinState.height } : null
    });
    return {
      ok: true,
      listTabId: listTab.id,
      messageTabId: messageTab.id,
      bounds,
      zoomFactor: SPLIT_ZOOM_FACTOR,
      zoomApplied: zoomApplied.every(Boolean)
    };
  } catch (error) {
    task.execution.splitViewActive = false;
    task.execution.splitViewError = String(error?.message || error);
    await chrome.tabs.update(listTab.id, { active: true }).catch(() => {});
    await chrome.windows.update(task.execution.listWindowId || listTab.windowId, { focused: true }).catch(() => {});
    return {
      ok: false,
      error: 'SPLIT_VIEW_FAILED',
      message: '浏览器未允许自动分屏，已回退为普通消息标签页：' + task.execution.splitViewError
    };
  }
}


async function ensureMessageTab(task) {
  if (runner.running && runner.abort) throw new Error('OP_CANCELLED');
  if (!task.execution) task.execution = {};
  const oldId = task.execution.messageTabId;
  if (oldId) {
    try {
      const t = await chrome.tabs.get(oldId);
      if (t && isBossUrl(t.url || t.pendingUrl || "")) {
        // 确保在消息中心
        if (!/\/chat/i.test(t.url || "")) {
          await chrome.tabs.update(oldId, { url: "https://www.zhipin.com/web/geek/chat", active: true });
          await waitTabComplete(oldId, 25000);
          await forceInjectContent(oldId);
        } else {
          try { await chrome.tabs.update(oldId, { active: true }); } catch (_) {}
        }
        if (task.execution.splitViewActive) await setSplitTabZoom(oldId);
        await log("info", "[消息页] 复用 tab=" + oldId + " url=" + String(t.url || "").slice(0, 120));
        return t;
      }
    } catch (_) {}
  }
  let tab;
  if (task.execution.splitViewActive && task.execution.splitBounds?.right) {
    const win = await chrome.windows.create({
      url: "https://www.zhipin.com/web/geek/chat",
      type: 'normal',
      focused: true,
      ...task.execution.splitBounds.right
    });
    tab = win.tabs?.[0] || (await chrome.tabs.query({ windowId: win.id }))[0];
    if (!tab?.id) throw new Error('无法在右侧重建消息窗口');
  } else {
    tab = await chrome.tabs.create({
      url: "https://www.zhipin.com/web/geek/chat",
      active: true,
      openerTabId: task.execution.listTabId || undefined
    });
  }
  task.execution.messageTabId = tab.id;
  task.execution.messageWindowId = tab.windowId;
  task.execution.phase = "MESSAGE_TAB_READY";
  await publishTask(task);
  await waitTabComplete(tab.id, 30000);
  if (task.execution.splitViewActive) await setSplitTabZoom(tab.id);
  await forceInjectContent(tab.id);
  await sleep(400);
  await log("info", "[消息页] 已创建 tab=" + tab.id);
  return tab;
}

async function refreshMessageTabOnce(task, tabId, { jobId = '', resumed = false } = {}) {
  if (runner.abort) return cancelledResult();
  await debugLog('background.messageTab', 'reload_begin', {
    taskId: task?.id,
    tabId,
    jobId,
    resumed
  });
  try {
    await chrome.tabs.reload(tabId);
    await waitTabComplete(tabId, 30000);
    if (runner.abort) return cancelledResult();
    if (task?.execution?.splitViewActive) await setSplitTabZoom(tabId);
    await forceInjectContent(tabId);
    await sleep(350);
    await log('info', `[消息页] 已刷新会话列表（${resumed ? '从检查点重试' : '触发沟通后'}）`, {
      jobId,
      tabId
    });
    await debugLog('background.messageTab', 'reload_complete', {
      taskId: task?.id,
      tabId,
      jobId,
      resumed
    });
    return { ok: true };
  } catch (error) {
    await log('warn', '[消息页] 刷新失败，将基于当前页面继续安全匹配：' + String(error?.message || error), {
      jobId,
      tabId
    });
    await debugLog('background.messageTab', 'reload_failed', {
      taskId: task?.id,
      tabId,
      jobId,
      resumed,
      error: serializeError(error)
    }, 'error');
    return { ok: false, error: String(error?.message || error) };
  }
}

async function softReturnToList(task) {
  if (runner.abort) return cancelledResult();
  const listTabId = task?.execution?.listTabId || null;
  const payload = {
    listHref: task?.listHref || "",
    expectLabel: task?.listExpectLabel || "",
    listExpectLabel: task?.listExpectLabel || ""
  };
  const opt = listTabId
    ? { tabId: listTabId, forceInject: true }
    : { forceInject: true };
  try {
    const res = await sendToBoss(MSG.RETURN_TO_LIST, payload, opt);
    if (res?.via === "hard-assign-last-resort" || res?.navigating) {
      await log("warn", "列表页只能硬跳转恢复（可能短暂丢失 SPA 筛选），将尝试点回求职期望", {
        via: res?.via,
        href: String(res?.href || payload.listHref || "").slice(0, 160),
        expectLabel: payload.expectLabel || ""
      });
    } else if (res?.ok) {
      await log("info", "列表页软恢复完成 via=" + (res.via || "ok"), {
        count: res.count,
        href: String(res.href || "").slice(0, 140),
        expect: res.expectRestored?.after || res.expectRestored?.label || payload.expectLabel || ""
      });
    }
    return res;
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function ensureListTab(task) {
  if (!task.execution) task.execution = {};
  if (task.execution.listTabId) {
    try {
      const t = await chrome.tabs.get(task.execution.listTabId);
      if (t && isBossUrl(t.url || "")) return t;
    } catch (_) {}
  }
  const t = await getActiveBossTab({ allowInactiveBossTab: true });
  if (t?.id) {
    task.execution.listTabId = t.id;
    task.execution.listWindowId = t.windowId;
    await publishTask(task);
  }
  return t;
}

async function getListTabFingerprint(tabId) {
  if (!tabId) return { tabId: null, url: '', contentInstanceId: '' };
  let tab = null;
  try { tab = await chrome.tabs.get(tabId); } catch (_) {}
  let contentInstanceId = '';
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: MSG.PING, payload: {} });
    contentInstanceId = String(pong?.contentInstanceId || '');
  } catch (_) {}
  return {
    tabId,
    url: String(tab?.url || tab?.pendingUrl || ''),
    windowId: tab?.windowId || null,
    contentInstanceId
  };
}

async function closeConversationWorkerTab(task, tabId, { reason = '', publish = true } = {}) {
  const workerTabId = tabId || task?.execution?.workerTabId || null;
  if (workerTabId) {
    try { await chrome.tabs.remove(workerTabId); } catch (_) {}
  }
  if (task?.execution && (!workerTabId || task.execution.workerTabId === workerTabId)) {
    delete task.execution.workerTabId;
    delete task.execution.workerMode;
    delete task.execution.workerUrl;
    task.updatedAt = Date.now();
    if (publish) await publishTask(task);
  }
  if (reason) {
    await debugLog('background.workerTab', 'closed', {
      taskId: task?.id || null,
      tabId: workerTabId,
      reason
    });
  }
  return { ok: true, tabId: workerTabId, closed: Boolean(workerTabId) };
}

async function openConversationWorkerTab(task, attempt, messageTab, job) {
  if (!task.execution) task.execution = {};
  if (task.execution.workerTabId) {
    await closeConversationWorkerTab(task, task.execution.workerTabId, {
      reason: '创建新执行页前清理旧执行页',
      publish: false
    });
  }
  const createOptions = {
    url: attempt.url,
    active: false
  };
  const targetWindowId = messageTab?.windowId || task.execution.messageWindowId || null;
  if (targetWindowId != null) createOptions.windowId = targetWindowId;
  if (messageTab?.id) createOptions.openerTabId = messageTab.id;
  const tab = await chrome.tabs.create(createOptions);
  if (!tab?.id) throw new Error('临时沟通执行页创建失败');
  task.execution.workerTabId = tab.id;
  task.execution.workerMode = attempt.mode;
  task.execution.workerUrl = attempt.url;
  task.updatedAt = Date.now();
  await publishTask(task);
  const ready = await waitTabComplete(tab.id, 30000);
  const readyUrl = ready?.url || ready?.pendingUrl || '';
  if (!ready?.id || !isBossUrl(readyUrl)) {
    throw new Error('临时沟通执行页未能加载 BOSS 岗位：' + String(readyUrl || attempt.url));
  }
  await forceInjectContent(tab.id);
  await sleep(250);
  return ready;
}

async function triggerConversationInWorker(task, job, messageTab, listTabId, activeWithin = []) {
  const listBefore = await getListTabFingerprint(listTabId);
  const selectedActiveBuckets = normalizeActiveWithin(activeWithin);
  const attempts = buildConversationWorkerAttempts({
    job,
    listHref: task?.listHref || job?.listHref || ''
  });
  if (!attempts.length) {
    return {
      ok: false,
      error: 'WORKER_TARGET_MISSING',
      message: '岗位缺少可用详情链接和列表锚点；为保护左侧筛选，已停止本次操作',
      listBefore
    };
  }

  let result = null;
  const attemptResults = [];
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    result = null;
    let workerTab = null;
    let triggerStarted = false;
    let activityInspection = null;
    let activityAccepted = null;
    try {
      if (selectedActiveBuckets.length) {
        // 活跃度在左侧职位页点该岗位卡片核对（BOSS 原生渲染），不打开新标签页
        activityInspection = await sendToBoss(
          MSG.INSPECT_JOB_DETAIL || 'BHT_INSPECT_JOB_DETAIL',
          { job },
          { tabId: listTabId }
        );
        if (operationAborted(activityInspection)) {
          result = activityInspection;
        } else {
          const activeText = String(activityInspection?.activeText || '').trim();
          job.activeText = activeText;
          activityAccepted = Boolean(
            activityInspection?.ok &&
            activeText &&
            matchActive(activeText, selectedActiveBuckets)
          );
          await log('info', `[列表页] 已点卡片核对 HR 活跃度：${activeText || '未知'}（${activityAccepted ? '满足' : '不满足'}）`, {
            jobId: job.jobId,
            activeText,
            activityAccepted,
            inspectError: activityInspection?.error || ''
          });
          if (!activityAccepted) {
            result = {
              ok: false,
              error: REASON.FILTER_ACTIVE,
              filtered: true,
              activeText,
              activityInspection,
              message: reasonText(REASON.FILTER_ACTIVE, activeText || '未知')
            };
          }
        }
      }
      if (!result) {
        workerTab = await openConversationWorkerTab(task, attempt, messageTab, job);
        await log('info', '[执行页] 已在后台打开岗位，不会操作左侧职位列表', {
          jobId: job.jobId,
          workerTabId: workerTab.id,
          mode: attempt.mode,
          url: String(attempt.url || '').slice(0, 180)
        });
        triggerStarted = true;
        result = await sendToBoss(
          MSG.TRIGGER_CONVERSATION || 'BHT_TRIGGER_CONVERSATION',
          {
            job: { ...job, listHref: task?.listHref || job?.listHref || '' },
            workerDetail: attempt.mode === CONVERSATION_WORKER_MODE.DETAIL
          },
          { tabId: workerTab.id, forceInject: true }
        );
      }
      attemptResults.push({
        mode: attempt.mode,
        url: attempt.url,
        ok: Boolean(result?.ok),
        error: result?.error || '',
        activeText: activityInspection?.activeText || '',
        activityAccepted,
        navigated: Boolean(result?.navigated)
      });
    } catch (error) {
      result = {
        ok: false,
        error: triggerStarted ? 'WORKER_TRIGGER_EXCEPTION' : 'WORKER_TAB_FAILED',
        message: '临时沟通执行页失败：' + String(error?.message || error)
      };
      attemptResults.push({ mode: attempt.mode, url: attempt.url, ok: false, error: result.error });
    } finally {
      if (workerTab?.id) {
        await closeConversationWorkerTab(task, workerTab.id, {
          reason: '本岗位沟通触发结束'
        });
      }
    }

    if (result?.ok || result?.filtered || operationAborted(result)) break;
    const safeToFallback = /WORKER_CHAT_BUTTON_NOT_FOUND|WORKER_TAB_FAILED|CONTENT_INJECT_FAIL|TARGET_TAB_CLOSED/.test(
      String(result?.error || '')
    );
    if (!safeToFallback) break;
  }

  const listAfter = await getListTabFingerprint(listTabId);
  const listPreserved = isListDocumentPreserved(listBefore, listAfter);
  await log(listPreserved ? 'success' : 'warn', listPreserved
    ? '[列表页] 左侧职位页保持原样：筛选、滚动位置和页面实例均未变化'
    : '[列表页] 检测到左侧页面发生外部变化；插件未在左侧触发沟通', {
    jobId: job.jobId,
    listBefore,
    listAfter,
    attempts: attemptResults
  });
  return {
    ...(result || { ok: false, error: 'WORKER_TRIGGER_EMPTY', message: '临时沟通执行页没有返回结果' }),
    workerMode: attemptResults[attemptResults.length - 1]?.mode || '',
    workerTabClosed: true,
    listPreserved,
    listBefore,
    listAfter,
    workerAttempts: attemptResults
  };
}

async function sendToBoss(type, payload = {}, { retries = 2, forceInject = false, tabId = null, previewRunId = '' } = {}) {
  // A preview generation remains authoritative even after STOP invalidates the
  // runner flags. Otherwise a stale caller created just after STOP could lose
  // its preview identity and start a new page operation on the hidden worker.
  const runKind = previewRunId ? 'preview' : runner.running ? 'task' : runner.previewing ? 'preview' : '';
  const taskBound = Boolean(runKind);
  const isCancelled = () => runKind === 'task'
    ? runner.abort
    : runKind === 'preview'
      ? !isPreviewRunActive(previewRunId)
      : false;
  const scanDeadlineAt = type === MSG.SCAN_JOBS
    ? Math.max(0, Number(payload?.deadlineAt || 0))
    : 0;
  const scanDeadlineResult = () => previewScanDeadlineResult();
  await debugLog('background.sendToBoss', 'begin', {
    type, tabId, retries, forceInject, taskBound,
    job: payload?.job ? {
      jobId: payload.job.jobId || '',
      title: payload.job.title || '',
      company: payload.job.company || '',
      hrName: payload.job.hrName || payload.job.bossName || ''
    } : null
  });
  if (isCancelled()) return cancelledResult();
  if (scanDeadlineAt && Date.now() >= scanDeadlineAt) return scanDeadlineResult();
  let tab = null;
  if (tabId != null) {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      return { ok: false, error: "TARGET_TAB_CLOSED", message: "目标标签页已关闭，请重新开始任务" };
    }
  } else {
    tab = await getActiveBossTab({ allowInactiveBossTab: false });
  }
  if (!tab?.id) {
    const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return {
      ok: false,
      error: "NO_BOSS_TAB",
      message: bossUrlGuardMessage(active?.url || "")
    };
  }
  if (!isBossUrl(tab.url || "")) {
    return {
      ok: false,
      error: "NOT_BOSS_URL",
      message: bossUrlGuardMessage(tab.url || "")
    };
  }

  const critical = [
    MSG.INSPECT_JOB_DETAIL,
    MSG.ENRICH_JOB_ACTIVITY,
    MSG.TRIGGER_CONVERSATION,
    MSG.WAIT_OPEN_CONVERSATION,
    MSG.WAIT_CHAT_EDITOR,
    MSG.SEND_TEXT,
    MSG.SEND_IMAGE,
    MSG.GET_BOSS_GREETING,
    MSG.SET_BOSS_GREETING,
    MSG.SAVE_BOSS_GREETING_TEXT,
    MSG.SCAN_JOBS,
    MSG.RETURN_TO_LIST,
    MSG.CLOSE_CHAT,
    MSG.ENSURE_JOB_LIST
  ];
  const longOps = [
    MSG.TRIGGER_CONVERSATION,
    MSG.WAIT_OPEN_CONVERSATION,
    MSG.WAIT_CHAT_EDITOR,
    MSG.SEND_TEXT,
    MSG.SEND_IMAGE,
    MSG.ENRICH_JOB_ACTIVITY,
    MSG.SCAN_JOBS,
    MSG.RETURN_TO_LIST
  ];

  let needInject = forceInject;
  let contentInstanceId = '';
  if (!needInject && critical.includes(type)) {
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} });
      contentInstanceId = String(pong?.contentInstanceId || '');
      const contentVersion = String(pong?.contentVersion || '');
      if (!pong?.ok || (BHT_RUNTIME_VERSION !== 'unknown' && contentVersion !== BHT_RUNTIME_VERSION)) {
        needInject = true;
        await debugLog('background.sendToBoss', 'content_version_reinject', {
          type,
          tabId: tab.id,
          runtimeVersion: BHT_RUNTIME_VERSION,
          contentVersion: contentVersion || 'unknown'
        }, 'warn');
      }
    } catch (_) {
      needInject = true;
    }
  }
  if (needInject) {
    if (isCancelled()) return cancelledResult();
    if (scanDeadlineAt && Date.now() >= scanDeadlineAt) return scanDeadlineResult();
    await forceInjectContent(tab.id, { deadlineAt: scanDeadlineAt });
    if (!await sleepWithinDeadline(180, scanDeadlineAt)) return scanDeadlineResult();
    if (isCancelled()) return cancelledResult();
    if (scanDeadlineAt && Date.now() >= scanDeadlineAt) return scanDeadlineResult();
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} });
      contentInstanceId = String(pong?.contentInstanceId || '');
      const contentVersion = String(pong?.contentVersion || '');
      if (BHT_RUNTIME_VERSION !== 'unknown' && contentVersion !== BHT_RUNTIME_VERSION) {
        return {
          ok: false,
          error: 'CONTENT_VERSION_MISMATCH',
          message: `BOSS 页面脚本仍是旧版本（页面 ${contentVersion || '未知'} / 后台 ${BHT_RUNTIME_VERSION}）。请按 F5 刷新 BOSS 页面后重试`,
          contentVersion,
          runtimeVersion: BHT_RUNTIME_VERSION
        };
      }
    } catch (_) {}
  }

  // 长操作优先 storage 桥（立即 ACK + 轮询结果），避免 SPA 销毁 channel
  let bridgeOpId = '';
  if (longOps.includes(type)) {
    try {
      const opId = 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      bridgeOpId = opId;
      const storageKey = 'bht_op_' + opId;
      const pageOperationTimeoutMs = resolvePageOperationTimeoutMs(type, payload);
      const bridgeTimeoutMs = scanDeadlineAt
        ? Math.max(0, scanDeadlineAt - Date.now())
        : resolveBridgeTimeoutMs(pageOperationTimeoutMs);
      if (scanDeadlineAt && bridgeTimeoutMs <= 0) return scanDeadlineResult();
      operations.add({ opId, tabId: tab.id, type, storageKey });
      const finishBridge = async (result, { removeStorage = true } = {}) => {
        operations.delete(opId);
        // Leave a cancellation tombstone until the page operation's finally
        // block releases its lock; cancelBridgeOperation cleans it up.
        if (removeStorage && result?.error !== 'OP_CANCELLED') {
          try { await chrome.storage.local.remove(storageKey); } catch (_) {}
        }
        return result;
      };
      await chrome.storage.local.remove(storageKey).catch(() => {});
      await chrome.storage.local.set({ [storageKey]: { status: 'pending', opType: type, at: Date.now() } });
      if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) {
        return await finishBridge(scanDeadlineResult());
      }
      const fireOp = async () => {
        if (isCancelled()) return false;
        if (scanDeadlineAt && Date.now() >= scanDeadlineAt) return false;
        await debugLog('background.sendToBoss', 'bridge_fire', { type, opId, tabId: tab.id });
        const ack = await chrome.tabs.sendMessage(tab.id, {
          type: 'BHT_RUN_OP',
          payload: {
            opId,
            opType: type,
            opPayload: {
              ...payload,
              __bhtDebugEnabled: debugLoggingEnabled,
              __bhtOperationTimeoutMs: pageOperationTimeoutMs
            }
          }
        });
        await debugLog('background.sendToBoss', 'bridge_ack', { type, opId, ack });
        if (ack && ack.accepted) return true;
        if (ack && ack.error === 'UNKNOWN_TYPE') return false;
        // 旧 content 无 RUN_OP 时走失败，触发注入重试
        return Boolean(ack && ack.ok !== false);
      };
      let fired = false;
      try {
        fired = await fireOp();
      } catch (eAck) {
        fired = false;
      }
      if (!fired) {
        if (isCancelled()) return await finishBridge(cancelledResult());
        if (scanDeadlineAt && Date.now() >= scanDeadlineAt) {
          return await finishBridge(scanDeadlineResult());
        }
        await forceInjectContent(tab.id, { deadlineAt: scanDeadlineAt });
        if (!await sleepWithinDeadline(220, scanDeadlineAt)) {
          return await finishBridge(scanDeadlineResult());
        }
        if (isCancelled()) return await finishBridge(cancelledResult());
        if (scanDeadlineAt && Date.now() >= scanDeadlineAt) {
          return await finishBridge(scanDeadlineResult());
        }
        fired = await fireOp();
      }
      if (!fired) throw new Error('RUN_OP_NOT_SUPPORTED');
      const started = Date.now();
      // Collection itself still ends at deadlineAt. Keep only the dedicated
      // result-finalization window so a large delta can finish writing without
      // extending collection or being discarded as a late transport row.
      const bridgeDeadlineAt = scanDeadlineAt
        ? scanDeadlineAt + OPERATION_TIMEOUTS.PREVIEW_RESULT_GRACE_MS
        : (started + bridgeTimeoutMs);
      const bridgeStartedUrl = tab.url || '';
      let navigationProbeAt = started + 700;
      let reinjectAt = started + 8000;
      while (Date.now() < bridgeDeadlineAt) {
        await sleep(Math.min(350, Math.max(0, bridgeDeadlineAt - Date.now())));
        if (isCancelled()) return await finishBridge(cancelledResult());
        const bag = await chrome.storage.local.get(storageKey);
        const row = bag && bag[storageKey];
        if (row?.status === 'cancelled') return await finishBridge(cancelledResult());
        if (row && row.status === 'done') {
          const result = row.result || { ok: false, error: 'EMPTY_OP_RESULT' };
          const completedAt = Number(row.at || Date.now());
          if (!isScanResultWithinFinalizationWindow(result, {
            collectionDeadlineAt: scanDeadlineAt,
            bridgeDeadlineAt,
            storageCompletedAt: completedAt
          })) continue;
          await debugLog('background.sendToBoss', 'bridge_done', {
            type,
            opId,
            elapsedMs: Date.now() - started,
            result: summarizeBossOperationResult(result)
          });
          if (result && result.error === 'OP_BUSY') {
            if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;
            try {
              await chrome.storage.local.set({
                [storageKey]: { status: 'pending', opType: type, at: Date.now(), note: 'ignore-op-busy' }
              });
            } catch (_) {}
            continue;
          }
          // 页面跳转中断：对发消息/开聊自动重试一次
          if (result && result.error === 'NAVIGATED' && type === MSG.SEND_TEXT && !payload.__navRetried) {
            if (isCancelled()) return await finishBridge(cancelledResult());
            await finishBridge(result);
            await forceInjectContent(tab.id);
            await sleep(350);
            if (isCancelled()) return cancelledResult();
            return await sendToBoss(type, { ...payload, __navRetried: true }, {
              retries,
              forceInject: true,
              tabId: tab.id,
              previewRunId
            });
          }
          return await finishBridge(result);
        }
        // Once collection time is over, only poll for a result that was
        // computed before the deadline.  Do not probe navigation or reinject
        // content during the transport grace window.
        if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) continue;
        if (type === MSG.SCAN_JOBS && Date.now() >= navigationProbeAt) {
          navigationProbeAt = Date.now() + 700;
          try {
            const latest = await chrome.tabs.get(tab.id);
            if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;
            const latestUrl = latest?.url || latest?.pendingUrl || '';
            let latestInstanceId = '';
            try {
              const pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} });
              latestInstanceId = String(pong?.contentInstanceId || '');
            } catch (_) {}
            if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;
            const instanceChanged = didContentDocumentChange({
              previousInstanceId: contentInstanceId,
              currentInstanceId: latestInstanceId,
              previousUrl: bridgeStartedUrl,
              currentUrl: latestUrl
            });
            if (instanceChanged) {
              const navigated = {
                ok: false,
                error: 'NAVIGATED',
                message: '页面已跳转，正在新页面继续扫描',
                fromHref: bridgeStartedUrl,
                href: latestUrl
              };
              await debugLog('background.sendToBoss', 'scan_navigation_detected', {
                type,
                opId,
                fromHref: bridgeStartedUrl,
                href: latestUrl,
                previousContentInstanceId: contentInstanceId,
                contentInstanceId: latestInstanceId
              }, 'info');
              return await finishBridge(navigated);
            }
          } catch (_) {}
        }
        // 超时前若仍 pending：content 被导航销毁时重注入并重发
        if (Date.now() > reinjectAt && longOps.includes(type)) {
          if (isCancelled()) return await finishBridge(cancelledResult());
          if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;
          reinjectAt = Date.now() + 12000;
          try {
            const latest = await chrome.tabs.get(tab.id);
            if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;
            if (!isBossUrl(latest?.url || '')) continue;

            let alive = false;
            let pong = null;
            try {
              pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} });
              alive = Boolean(
                pong?.ok &&
                (BHT_RUNTIME_VERSION === 'unknown' || String(pong?.contentVersion || '') === BHT_RUNTIME_VERSION)
              );
            } catch (_) { alive = false; }
            if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;

            // 其它长操作：仅当 content 已死时重注入并重发一次（content 侧 opId 幂等）
            if (!alive) {
              await debugLog('background.sendToBoss', 'content_missing_reinject', {
                type, opId, tabId: tab.id, url: latest?.url || ''
              }, 'warn');
              if (isCancelled()) return await finishBridge(cancelledResult());
              if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;
              await forceInjectContent(tab.id, { deadlineAt: scanDeadlineAt });
              if (!await sleepWithinDeadline(280, scanDeadlineAt)) break;
              if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;
              await fireOp();
            }
          } catch (_) {}
        }
      }
      if (scanDeadlineAt) {
        // SCAN_JOBS 的页面内计时器会在结果收尾预算结束时取消工作；此处不再
        // 用同一个 storage key 写 cancelled，避免覆盖刚写入的 done 结果。
        operations.delete(opId);
        scheduleBridgeStorageCleanup(storageKey);
        await debugLog('background.sendToBoss', 'scan_deadline', {
          type,
          opId,
          pageOperationTimeoutMs,
          bridgeTimeoutMs,
          elapsedMs: Date.now() - started
        });
        return await finishBridge(scanDeadlineResult(), { removeStorage: false });
      }
      const bridgeSettled = await cancelBridgeOperation({
        opId,
        tabId: tab.id,
        storageKey,
        reason: '操作结果通道超过统一预算，取消页面内旧操作'
      });
      await debugLog('background.sendToBoss', 'bridge_timeout', {
        type,
        opId,
        pageOperationTimeoutMs,
        bridgeTimeoutMs,
        elapsedMs: Date.now() - started
      }, 'error');
      return await finishBridge({
        ok: false,
        error: 'OP_BRIDGE_TIMEOUT',
        message: type === MSG.SCAN_JOBS
          ? '扫描页长时间没有返回结果，已停止该页操作并使用此前已收集的岗位'
          : '页面操作长时间没有返回结果，已安全停止；请确认页面状态后重试'
      }, { removeStorage: bridgeSettled });
    } catch (bridgeErr) {
      await debugLog('background.sendToBoss', 'bridge_failed', {
        type, opId: bridgeOpId, error: serializeError(bridgeErr)
      }, 'error');
      if (bridgeOpId) {
        const failedOperation = {
          opId: bridgeOpId,
          tabId: tab.id,
          storageKey: 'bht_op_' + bridgeOpId,
          reason: '存储桥失败，取消旧操作后切换备用通道'
        };
        if (type === MSG.SCAN_JOBS) {
          await requestBridgeCancellation(failedOperation);
          scheduleBridgeStorageCleanup(failedOperation.storageKey);
        } else {
          await cancelBridgeOperation(failedOperation);
        }
        operations.delete(bridgeOpId);
      }
      if (isCancelled()) return cancelledResult();
      if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) return scanDeadlineResult();
      console.warn('storage bridge fail', bridgeErr);
      return {
        ok: false,
        error: 'OP_BRIDGE_FAIL',
        message: '页面操作通道不可用，已安全停止本次操作：' + String(bridgeErr?.message || bridgeErr)
      };
    }
  }

  try {
    if (isCancelled()) return cancelledResult();
    try {
      return await chrome.tabs.sendMessage(tab.id, { type, payload });
    } catch (err0) {
      const msg0 = String(err0?.message || err0 || "");
      if (retries > 0 && /message channel closed|Receiving end does not exist|asynchronous response|Could not establish|PORT_/i.test(msg0)) {
        await forceInjectContent(tab.id);
        await sleep(450);
        return sendToBoss(type, payload, {
          retries: retries - 1,
          forceInject: true,
          tabId: tab.id,
          previewRunId
        });
      }
      await forceInjectContent(tab.id);
      await sleep(200);
      return await chrome.tabs.sendMessage(tab.id, { type, payload });
    }
  } catch (err) {
    await debugLog('background.sendToBoss', 'direct_channel_exception', {
      type,
      tabId: tab?.id || null,
      error: serializeError(err)
    }, 'error');
    try {
      const latest = await chrome.tabs.get(tab.id);
      if (!isBossUrl(latest?.url || "")) {
        return {
          ok: false,
          error: "NOT_BOSS_URL",
          message: bossUrlGuardMessage(latest?.url || "")
        };
      }
      await forceInjectContent(tab.id);
      await sleep(250);
      return await chrome.tabs.sendMessage(tab.id, { type, payload });
    } catch (e2) {
      await debugLog('background.sendToBoss', 'content_inject_failed', {
        type,
        tabId: tab?.id || null,
        firstError: serializeError(err),
        retryError: serializeError(e2)
      }, 'error');
      return {
        ok: false,
        error: "CONTENT_INJECT_FAIL",
        message: String(e2?.message || err?.message || e2)
      };
    }
  }
}

async function assertBossContext(sender = null) {
  const tab = await getActiveBossTab({ allowInactiveBossTab: false, sender });
  if (!tab) {
    const senderTab = await tabFromSender(sender);
    const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const fallback = senderTab || active;
    return {
      ok: false,
      error: "NO_BOSS_TAB",
      message: bossUrlGuardMessage(fallback?.url || ""),
      activeTab: fallback ? { id: fallback.id, url: fallback.url, title: fallback.title } : null
    };
  }
  return { ok: true, tab };
}

async function log(level, message, extra = {}) {
  const entry = await appendLog({ level, message, ...extra });
  await debugLog('background.log', 'runtime_log', { message, ...extra }, level);
  try {
    chrome.runtime.sendMessage({ type: MSG.LOG_EVENT, payload: entry }).catch(() => {});
  } catch (_) {}
  return entry;
}

async function publishTask(task) {
  // STOP 是不可逆终态：旧异步分支即使稍后返回，也不能把 storage 写回 running/paused。
  if (runner.running && runner.abort && task?.status !== TASK_STATUS.STOPPED) {
    task.status = TASK_STATUS.STOPPED;
    task.updatedAt = Date.now();
    setTaskTerminalSignal(task, TASK_STATUS.STOPPED);
  }
  task.revision = Number(task.revision || 0) + 1;
  await saveTask(task);
  try {
    chrome.runtime.sendMessage({ type: MSG.TASK_EVENT, payload: task }).catch(() => {});
  } catch (_) {}
}

function operationAborted(result) {
  return runner.abort || result?.error === 'OP_CANCELLED';
}

function taskSummaryText(task, status) {
  const counters = taskCounterSnapshot(task);
  const action = status === TASK_STATUS.STOPPED ? '任务已停止' : '投递任务已完成';
  return `${action}：成功投递 ${counters.success} 份，跳过 ${counters.skipped}，失败 ${counters.failed}，共处理 ${counters.processed}`;
}

function setTaskTerminalSignal(task, status) {
  const type = status === TASK_STATUS.STOPPED ? 'TASK_STOPPED' : 'TASK_COMPLETED';
  const previous = task?.completionSignal?.type === type ? task.completionSignal : null;
  task.completionSignal = {
    type,
    status: 'confirmed',
    receiptId: previous?.receiptId || uid(status === TASK_STATUS.STOPPED ? 'task_stopped' : 'task_done'),
    taskId: task.id,
    counters: taskCounterSnapshot(task),
    completedAt: previous?.completedAt || Date.now()
  };
  return task.completionSignal;
}

function ensureItem(task, job) {
  let item = task.items.find((x) => x.jobId === job.jobId);
  if (!item) {
    item = {
      jobId: job.jobId,
      bossId: job.bossId,
      company: job.company,
      title: job.title,
      state: 'NOT_STARTED',
      reasons: [],
      selected: true
    };
    task.items.push(item);
  }
  return item;
}

async function navigatePreviewToJobList(previewTab, scan = {}, previewRunId = '', deadlineAt = 0) {
  if (deadlineReached(deadlineAt)) return previewScanDeadlineResult();
  const targetHref = resolveBossJobListUrl({
    candidate: scan?.targetHref || scan?.listHref || '',
    currentUrl: previewTab?.url || ''
  });

  setPreviewPhase('navigating', previewRunId);
  await log('info', '当前不在职位列表页，正在自动跳转到职位列表…', {
    from: previewTab?.url || '',
    targetHref
  });
  if (deadlineReached(deadlineAt)) return previewScanDeadlineResult({ targetHref });

  try {
    await chrome.tabs.update(previewTab.id, { url: targetHref });
    if (deadlineReached(deadlineAt)) return previewScanDeadlineResult({ targetHref });
    const navigationWaitMs = remainingDeadlineMs(deadlineAt, OPERATION_TIMEOUTS.PREVIEW_LIST_NAV_MS);
    if (deadlineAt && navigationWaitMs <= 0) return previewScanDeadlineResult({ targetHref });
    const readyTab = await waitTabComplete(previewTab.id, navigationWaitMs, {
      shouldStop: () => !isPreviewRunActive(previewRunId) || deadlineReached(deadlineAt),
      requireComplete: true,
      deadlineAt
    });
    if (deadlineReached(deadlineAt)) return previewScanDeadlineResult({ targetHref });
    if (!readyTab || !isBossUrl(readyTab.url || readyTab.pendingUrl || '')) {
      return {
        ok: false,
        error: 'LIST_NAV_FAILED',
        message: '自动跳转职位列表失败，请手动打开 BOSS 职位推荐/搜索列表页后重试',
        targetHref
      };
    }
    await forceInjectContent(previewTab.id, { deadlineAt });
    if (!await sleepWithinDeadline(300, deadlineAt)) {
      return previewScanDeadlineResult({ targetHref });
    }
    if (deadlineReached(deadlineAt)) return previewScanDeadlineResult({ targetHref });
    return {
      ok: true,
      targetHref,
      tab: readyTab,
      navigation: {
        automatic: true,
        from: previewTab?.url || '',
        to: readyTab.url || targetHref,
        reason: 'NON_LIST_PAGE'
      }
    };
  } catch (error) {
    if (deadlineReached(deadlineAt)) return previewScanDeadlineResult({ targetHref });
    await debugLog('background.preview', 'list_navigation_failed', {
      tabId: previewTab?.id || null,
      targetHref,
      error: serializeError(error)
    }, 'error');
    return {
      ok: false,
      error: 'LIST_NAV_FAILED',
      message: '自动跳转职位列表失败，请手动打开 BOSS 职位推荐/搜索列表页后重试',
      targetHref
    };
  }
}

async function restoreListTabAfterTriggerNavigation(task, tabId) {
  if (!tabId) return { ok: false, error: 'LIST_TAB_MISSING', message: '列表标签页不存在' };
  let before = null;
  try { before = await chrome.tabs.get(tabId); } catch (_) {}
  const fromHref = before?.url || before?.pendingUrl || '';
  if (isBossJobListUrl(fromHref)) return { ok: true, restored: false, href: fromHref };
  const targetHref = resolveBossJobListUrl({
    candidate: task?.listHref || '',
    currentUrl: fromHref
  });
  await log('warn', '[列表页] BOSS 在沟通成功后跳到聊天页，正在自动恢复职位列表…', {
    tabId,
    fromHref,
    targetHref
  });
  try {
    await chrome.tabs.update(tabId, { url: targetHref });
    const ready = await waitTabComplete(tabId, 45000);
    const href = ready?.url || ready?.pendingUrl || targetHref;
    if (!ready || !isBossJobListUrl(href)) {
      return {
        ok: false,
        error: 'LIST_RESTORE_FAILED',
        message: '沟通已创建，但职位列表自动恢复失败。请手动打开职位列表后继续',
        fromHref,
        targetHref,
        href
      };
    }
    await forceInjectContent(tabId);
    await sleep(300);
    await log('success', '[列表页] 职位列表已自动恢复，可继续处理下一岗位', {
      tabId,
      fromHref,
      href
    });
    return { ok: true, restored: true, fromHref, href };
  } catch (error) {
    return {
      ok: false,
      error: 'LIST_RESTORE_FAILED',
      message: '沟通已创建，但职位列表自动恢复失败：' + String(error?.message || error),
      fromHref,
      targetHref
    };
  }
}

async function scanPreviewJobs(payload, previewTab, previewRunId = '') {
  const scanPayload = {
    scroll: payload.scroll !== false,
    // 每批短暂滚动并返回 delta，后台持续合并；页面异常时最多只损失最后一批。
    continuous: payload.continuous === true,
    maxRounds: payload.maxRounds || 24,
    scrollWaitMs: payload.scrollWaitMs ?? 100,
    scanSessionId: payload.scanSessionId || uid('scan'),
    resetSession: payload.resetSession !== false,
    deltaOnly: true,
    deadlineAt: Math.max(0, Number(payload.deadlineAt || 0))
  };
  let navigation = null;
  setPreviewPhase('collecting', previewRunId);
  let scan = await sendToBoss(MSG.SCAN_JOBS, scanPayload, {
    tabId: previewTab?.id || null,
    previewRunId
  });

  if (!scan?.ok && scan?.error === 'NAVIGATED') {
    if (deadlineReached(scanPayload.deadlineAt)) {
      return { scan: previewScanDeadlineResult(), navigation, previewTab };
    }
    setPreviewPhase('waiting_navigation', previewRunId);
    await log('info', '页面正在返回职位列表，等待加载完成后继续扫描…');
    const navigationWaitMs = remainingDeadlineMs(
      scanPayload.deadlineAt,
      OPERATION_TIMEOUTS.PREVIEW_LIST_NAV_MS
    );
    if (scanPayload.deadlineAt && navigationWaitMs <= 0) {
      return { scan: previewScanDeadlineResult(), navigation, previewTab };
    }
    const readyTab = await waitTabComplete(previewTab.id, navigationWaitMs, {
      shouldStop: () => !isPreviewRunActive(previewRunId) || deadlineReached(scanPayload.deadlineAt),
      requireComplete: true,
      deadlineAt: scanPayload.deadlineAt
    });
    if (deadlineReached(scanPayload.deadlineAt)) {
      return { scan: previewScanDeadlineResult(), navigation, previewTab };
    }
    if (readyTab) {
      previewTab = readyTab;
      await forceInjectContent(previewTab.id, { deadlineAt: scanPayload.deadlineAt });
      if (!await sleepWithinDeadline(300, scanPayload.deadlineAt)) {
        return { scan: previewScanDeadlineResult(), navigation, previewTab };
      }
      if (deadlineReached(scanPayload.deadlineAt)) {
        return { scan: previewScanDeadlineResult(), navigation, previewTab };
      }
      setPreviewPhase('scanning_cards', previewRunId);
      scan = await sendToBoss(MSG.SCAN_JOBS, scanPayload, {
        tabId: previewTab.id,
        previewRunId
      });
      navigation = {
        automatic: true,
        from: '',
        to: readyTab.url || '',
        reason: 'SOFT_RETURN_RELOADED'
      };
    }
  }

  if (!scan?.ok && scan?.shouldNavigate === true) {
    if (deadlineReached(scanPayload.deadlineAt)) {
      return { scan: previewScanDeadlineResult(), navigation, previewTab };
    }
    const nav = await navigatePreviewToJobList(
      previewTab,
      scan,
      previewRunId,
      scanPayload.deadlineAt
    );
    if (!nav.ok) return { scan: nav, navigation };
    previewTab = nav.tab || previewTab;
    navigation = nav.navigation;
    if (deadlineReached(scanPayload.deadlineAt)) {
      return { scan: previewScanDeadlineResult(), navigation, previewTab };
    }
    setPreviewPhase('scanning_cards', previewRunId);
    scan = await sendToBoss(MSG.SCAN_JOBS, scanPayload, {
      tabId: previewTab.id,
      previewRunId
    });
  }

  if (!scan?.ok && navigation) {
    const currentHref = scan?.page?.href || previewTab?.url || '';
    if (scan?.shouldNavigate === true && /\/web\/user\/?(?:[?#]|$)|passport|\/login/i.test(currentHref)) {
      scan = {
        ...scan,
        error: 'LOGIN_REQUIRED',
        message: '已自动打开职位列表，但 BOSS 跳转到了登录页。请先登录后再扫描预览',
        shouldNavigate: false
      };
    } else if (scan?.error === 'LIST_NOT_FOUND' || scan?.shouldNavigate === true) {
      scan = {
        ...scan,
        error: 'LIST_NOT_FOUND',
        message: '已自动进入 BOSS 职位列表，但仍未找到岗位卡片。请确认已登录、当前筛选下有岗位，或刷新页面后重试',
        shouldNavigate: false
      };
    }
  }

  return { scan, navigation, previewTab };
}

function evaluatePreviewResults(jobs = [], config = {}, todayStats = {}) {
  const history = config.history || [];
  const idempotency = config.idempotency || {};
  const results = [];
  for (const job of jobs) {
    const filterRes = evaluateJob(
      job,
      config.filters,
      config.lists,
      config.settings,
      { deferUnknownActive: true }
    );
    let decision = filterRes.decision;
    let reasonCodes = filterRes.reasonCodes || [];
    let reasonTexts = filterRes.reasonTexts || [];
    let passReasons = filterRes.passReasons || [];
    let requiresActiveCheck = filterRes.requiresActiveCheck === true;
    if (decision === 'pass') {
      const dedup = checkDedup(job, {
        settings: config.settings,
        history,
        todayStats,
        taskItemKeys: new Set(),
        idempotency
      });
      if (!dedup.ok) {
        decision = 'reject';
        reasonCodes = dedup.reasonCodes;
        reasonTexts = dedup.reasonTexts;
        passReasons = [];
        requiresActiveCheck = false;
      }
    }
    results.push({
      job,
      decision,
      reasonCodes,
      reasonTexts,
      passReasons,
      requiresActiveCheck: decision === 'pass' && requiresActiveCheck,
      selected: decision === 'pass'
    });
  }
  return results;
}

function applyPreviewActivityEnrichment(results = [], activities = [], activeWithin = [], excludeHunter = true) {
  const byJobId = new Map(
    (activities || [])
      .filter((item) => item?.jobId)
      .map((item) => [String(item.jobId), item])
  );
  let resolved = 0;
  let rejected = 0;
  for (const row of results || []) {
    if (row?.decision !== 'pass' || row?.requiresActiveCheck !== true) continue;
    const activity = byJobId.get(String(row.job?.jobId || ''));
    const activeText = String(activity?.activeText || '').trim();
    const goldHunter = activity?.goldHunter === true || row.job?.goldHunter === true;
    const hrTitle = activity?.hrTitle || row.job?.hrTitle || '';
    if (!activeText && !goldHunter) continue;
    row.job = {
      ...(row.job || {}),
      activeText,
      online: activity?.bossOnline === true,
      goldHunter: activity?.goldHunter === true || row.job?.goldHunter === true,
      hrTitle: activity?.hrTitle || row.job?.hrTitle || '',
      bossId: activity?.bossId || row.job?.bossId || '',
      hrName: activity?.bossName || row.job?.hrName || ''
    };
    row.requiresActiveCheck = false;
    resolved += 1;
    if (excludeHunter && looksHunter(row.job)) {
      row.decision = 'reject';
      row.selected = false;
      row.reasonCodes = [REASON.FILTER_HUNTER];
      row.reasonTexts = [reasonText(REASON.FILTER_HUNTER)];
      rejected += 1;
    } else if (matchActive(activeText, activeWithin)) {
      row.passReasons = [...(row.passReasons || []), `HR 活跃：${activeText}`];
    } else {
      row.decision = 'reject';
      row.selected = false;
      row.reasonCodes = [REASON.FILTER_ACTIVE];
      row.reasonTexts = [reasonText(REASON.FILTER_ACTIVE, activeText)];
      rejected += 1;
    }
  }
  return { resolved, rejected };
}

function finalizePreviewActivityDecisions(results = [], activeWithin = []) {
  // 预览不点列表卡、不拉详情。未知活跃留给投递时的临时详情页核对。
  void results;
  void activeWithin;
  return { rejected: 0 };
}

function mergePreviewJobBatch(target, jobs = []) {
  for (const job of jobs || []) {
    const key = String(job?.jobId || `${normalizeMatchText(job?.title || '')}|${normalizeMatchText(job?.company || '')}`);
    if (!key) continue;
    const previous = target.get(key);
    target.set(key, { ...(previous || {}), ...(job || {}) });
  }
  return target.size;
}


async function runPreview(payload = {}, previewTab = null, previewRunId = runner.previewRunId) {
  const isActive = () => isPreviewRunActive(previewRunId);
  const cancelled = () => previewCancelledResult();
  if (!isActive()) return cancelled();
  await log('info', '开始扫描预览…');
  if (!isActive()) return cancelled();
  const config = await getAllConfig();
  if (!isActive()) return cancelled();
  runner.previewPreviousTask = cloneTaskSnapshot(config.task);
  const scanSessionId = uid('scan');
  const requestedMaxScanMs = Number(payload.maxScanMs);
  const maxElapsedMs = Number.isFinite(requestedMaxScanMs) && requestedMaxScanMs > 0
    ? Math.max(1000, Math.min(OPERATION_TIMEOUTS.PREVIEW_SCROLL_MS, requestedMaxScanMs))
    : OPERATION_TIMEOUTS.PREVIEW_SCROLL_MS;
  const previewStartedAt = runner.previewStartedAt || Date.now();
  const sourcePreviewTab = previewTab || await getActiveBossTab({ allowInactiveBossTab: false });
  if (!sourcePreviewTab?.id) {
    return { ok: false, error: 'LIST_TAB_NOT_FOUND', message: '请先打开当前要扫描的 BOSS 职位列表页' };
  }
  previewTab = sourcePreviewTab;
  {
    // BOSS 的求职期望和部分筛选只存在当前 SPA 状态中。
    // 直接滚动当前职位页，才能保证扫描的就是用户看到的这批岗位。
    const scanStartedAt = Date.now();
    runner.previewScanStartedAt = scanStartedAt;
    runner.previewScanFinishedAt = 0;
    setPreviewPhase('collecting', previewRunId);
    const previewDeadlineAt = scanStartedAt + maxElapsedMs;
    // 预留固定结果收尾预算；采集到点即停，整个扫描结果通道仍受 60 秒上限约束。
    const deadlineAt = Math.max(
      scanStartedAt + 1000,
      previewDeadlineAt - OPERATION_TIMEOUTS.PREVIEW_RESULT_GRACE_MS
    );
    await log('info', '[扫描] 正在当前职位页向下加载岗位，现有求职期望和筛选保持不变', {
      tabId: sourcePreviewTab.id,
      url: sourcePreviewTab.url || sourcePreviewTab.pendingUrl || ''
    });
    if (!isActive()) return cancelled();
    const scanResult = await scanPreviewJobs({
      ...payload,
      scanSessionId,
      resetSession: true,
      deadlineAt,
      continuous: true,
      maxRounds: Math.max(64, Math.min(512, Number(payload.maxRounds || 512))),
      scrollWaitMs: payload.scrollWaitMs ?? 100
    }, previewTab, previewRunId);
    if (!isActive()) return cancelled();
    let scan = scanResult.scan;
    previewTab = scanResult.previewTab || previewTab;
    const previewNavigation = scanResult.navigation || null;
    let continuationError = '';
    let scanBatches = 1;
    const collectedJobs = new Map();
    mergePreviewJobBatch(collectedJobs, scan?.jobs || []);
    const scanDeadlinePartial = Boolean(
      scan?.error === 'OP_DEADLINE_EXCEEDED' ||
      scan?.scanMeta?.timedOut === true
    );
    if (!scan?.ok && !(scanDeadlinePartial && collectedJobs.size)) {
      await log('error', scan?.message || '扫描失败', { error: scan?.error });
      return { ok: false, ...scan, navigation: previewNavigation };
    }
    if (scanDeadlinePartial) {
      scan = {
        ...(scan || {}),
        scanMeta: { ...(scan?.scanMeta || {}), timedOut: true }
      };
    }
    setPreviewProgress(collectedJobs.size, 0, previewRunId);

    // 滚动阶段只采集和去重；确认到底或到达统一截止时间后，才执行一次筛选。
    while (scan?.scanMeta?.reachedEnd !== true && scan?.scanMeta?.timedOut !== true && Date.now() < deadlineAt) {
      if (!isActive()) {
        return cancelled();
      }
      setPreviewPhase('collecting', previewRunId);
      await debugLog('background.preview', 'collection_progress', {
        collected: collectedJobs.size,
        scanSessionId,
        elapsedMs: Date.now() - scanStartedAt,
        scanBatches,
        scanMeta: scan.scanMeta || null
      });
      const more = await sendToBoss(MSG.SCAN_JOBS, {
        scroll: true,
        continuous: true,
        maxRounds: Math.max(64, Math.min(512, Number(payload.batchRounds || 512))),
        scrollWaitMs: payload.scrollWaitMs ?? 100,
        scanSessionId,
        resetSession: false,
        deltaOnly: true,
        deadlineAt
      }, { tabId: previewTab?.id || null, previewRunId });
      if (!isActive()) return cancelled();
      if (operationAborted(more)) {
        mergePreviewJobBatch(collectedJobs, more?.jobs || []);
        if (collectedJobs.size) {
          scan = {
            ...scan,
            ...(more || {}),
            scanMeta: { ...(scan.scanMeta || {}), ...(more?.scanMeta || {}), timedOut: true }
          };
          break;
        }
        return { ok: false, error: 'OP_CANCELLED', message: '已取消本次扫描预览' };
      }
      mergePreviewJobBatch(collectedJobs, more?.jobs || []);
      if (!more?.ok) {
        const deadlineReached = Date.now() >= deadlineAt || more?.error === 'OP_DEADLINE_EXCEEDED';
        if (deadlineReached) {
          scan = {
            ...scan,
            ...(more || {}),
            scanMeta: { ...(scan.scanMeta || {}), ...(more?.scanMeta || {}), timedOut: true }
          };
        } else {
          continuationError = more?.message || more?.error || '继续滚动扫描失败';
          await log('warn', '继续滚动扫描未完成，将使用当前已加载岗位：' + continuationError, {
            error: more?.error || '',
            scanSessionId
          });
        }
        break;
      }
      scanBatches += 1;
      scan = {
        ...scan,
        ...more,
        listHref: more.listHref || scan.listHref,
        listExpectLabel: more.listExpectLabel || scan.listExpectLabel
      };
      setPreviewProgress(collectedJobs.size, 0, previewRunId);
    }

    if (!isActive()) return cancelled();
    const collectionResultReceivedAt = Date.now();
    const collectionFinishedAt = Number(scan.scanMeta?.collectionFinishedAt || 0) ||
      Math.min(collectionResultReceivedAt, deadlineAt);
    runner.previewScanFinishedAt = Math.min(collectionFinishedAt, deadlineAt);
    setPreviewPhase('filtering', previewRunId);
    const todayStats = await getTodayStats();
    if (!isActive()) return cancelled();
    const results = evaluatePreviewResults(Array.from(collectedJobs.values()), config, todayStats);
    const activityMeta = {
      requested: 0,
      eligible: 0,
      checked: 0,
      resolved: 0,
      rejected: 0,
      halted: false,
      haltError: '',
      deferredToDelivery: results.filter((row) => row.decision === 'pass' && row.requiresActiveCheck === true).length
    };
    finalizePreviewActivityDecisions(results, config.filters?.activeWithin || []);
    const summary = summarizePreview(results);
    setPreviewProgress(summary.scanned, summary.pass, previewRunId);
    const previewListHref = scan.listHref || '';
    const previewListExpect = scan.listExpectLabel || scan.expectLabel || '';
    const passRate = summary.scanned ? summary.pass / summary.scanned : 0;
    const warnings = [];
    if (summary.scanned >= 10 && passRate > 0.8) warnings.push('通过率超过 80%，请检查筛选是否过宽');
    if (summary.scanned >= 10 && passRate < 0.05) warnings.push('通过率低于 5%，请检查筛选是否过严');
    const { reachedEnd, timedOut } = normalizePreviewScanTerminalState({
      reachedEnd: scan.scanMeta?.reachedEnd === true,
      timedOut: scan.scanMeta?.timedOut === true,
      deadlineAt
    });
    const stop = resolvePreviewScanStop({
      reachedEnd,
      timedOut,
      deadlineAt,
      batchError: continuationError,
      maxElapsedMs
    });
    if (stop.reason === PREVIEW_SCAN_STOP.TIMEOUT) {
      await debugLog('background.preview', 'collection_deadline', {
        scanSessionId,
        collected: collectedJobs.size,
        elapsedMs: collectionFinishedAt - scanStartedAt,
        maxElapsedMs
      });
    }
    if (stop.reason === PREVIEW_SCAN_STOP.BATCH_ERROR) warnings.push('继续加载异常：' + continuationError);
    const scanMeta = {
      ...(scan.scanMeta || {}),
      uniqueCount: collectedJobs.size,
      reachedEnd,
      timedOut,
      sourceContextPreserved: true,
      scanTabId: sourcePreviewTab.id,
      stopReason: stop.reason,
      stopMessage: stop.message,
      elapsedMs: Date.now() - previewStartedAt,
      scrollElapsedMs: collectionFinishedAt - scanStartedAt,
      collectionFinishedAt,
      collectionResultReceivedAt,
      previewDeadlineAt,
      maxElapsedMs,
      scanBatches,
      activity: activityMeta,
      passRate
    };

    const task = {
    id: uid('task'),
    status: TASK_STATUS.AWAITING_CONFIRM,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    summary,
    warnings,
    results,
    items: results.map((r) => ({
      jobId: r.job.jobId,
      bossId: r.job.bossId,
      company: r.job.company,
      title: r.job.title,
      state: r.decision === 'pass' ? 'NOT_STARTED' : 'SKIPPED',
      reasons: r.reasonTexts,
      selected: r.selected,
      decision: r.decision
    })),
    testedJobIds: [],
    counters: { processed: 0, success: 0, skipped: 0, failed: 0 },
    currentJobId: null,
    consecutiveFails: 0,
    execution: {
      listTabId: sourcePreviewTab?.id || previewTab?.id || null,
      listWindowId: sourcePreviewTab?.windowId || previewTab?.windowId || null
    },
    previewNavigation,
    scanMeta
  };

  
  task.listHref = previewListHref || '';
  if (previewListExpect) {
    task.listExpectLabel = previewListExpect;
  }
  task.queue = (task.results || [])
    .filter((r) => r.selected !== false && r.decision === 'pass')
    .map((r, idx) => ({
      index: idx,
      jobId: r.job?.jobId,
      title: r.job?.title,
      company: r.job?.company,
      href: r.job?.href || '',
      securityId: r.job?.securityId || '',
      status: 'pending'
    }));
  task.queueCursor = 0;
  await log('info', '预览队列已建立：' + task.queue.length + ' 个待投');
    if (!isActive()) return cancelled();
    const published = await publishPreviewTask(task, previewRunId, runner.previewPreviousTask);
    if (!published) return cancelled();

  // highlight
  if (!isActive()) return cancelled();
  const map = {};
  for (const r of results) map[r.job.jobId] = { decision: r.decision };
  await sendToBoss(MSG.HIGHLIGHT_JOBS, { map }, {
    tabId: sourcePreviewTab?.id || previewTab?.id || null,
    previewRunId
  });
  if (!isActive()) return cancelled();

  await log('success', `预览完成：扫描 ${summary.scanned}，通过 ${summary.pass}，排除 ${summary.reject}`, {
    scanMeta
  });
  return { ok: true, task, summary, warnings, scanMeta, navigation: previewNavigation };
  }
}

function itemErrorHint(task, row) {
  const item = (task.items || []).find((x) => x.jobId === row?.job?.jobId);
  const reason = (item?.reasons || []).filter(Boolean).join('；');
  return reason || task.pauseReason || '';
}

async function waitWhilePaused() {
  // 不在此处重复 publish，避免弹窗被 TASK_EVENT 反复触发
  while (runner.pause && !runner.abort) {
    await sleep(350);
  }
}

async function syncTaskBossGreeting(task, tabOpt, { force = false } = {}) {
  const cached = task?.bossGreetingSnapshot;
  if (!force && cached?.ok && Date.now() - Number(cached.syncedAt || 0) < 3 * 60 * 1000) {
    return cached;
  }
  const result = await sendToBoss(MSG.GET_BOSS_GREETING, {}, tabOpt);
  if (result?.ok) {
    task.bossGreetingSnapshot = {
      ok: true,
      enabled: result.enabled === true,
      status: result.enabled === true ? 'on' : 'off',
      templateId: result.templateId || '',
      text: result.text || '',
      syncedAt: result.syncedAt || Date.now(),
      source: result.source || 'boss-api'
    };
    task.bossGreetingError = '';
  } else {
    task.bossGreetingError = result?.message || result?.error || '无法读取 BOSS 自动招呼状态';
  }
  task.updatedAt = Date.now();
  await publishTask(task);
  return result;
}

async function waitForFreshSelfMessages(tabOpt, baselineMessages = [], timeoutMs = 2600) {
  const started = Date.now();
  const baseline = (baselineMessages || []).map((message) => String(message || '').trim()).filter(Boolean);
  const baselineKey = JSON.stringify(baseline);
  let latest = baseline;
  while (Date.now() - started < timeoutMs) {
    const result = await sendToBoss(MSG.GET_CHAT_SELF_MESSAGES, { limit: 8 }, tabOpt);
    if (operationAborted(result)) return [];
    latest = (result?.messages || []).map((message) => String(message || '').trim()).filter(Boolean);
    if (JSON.stringify(latest) !== baselineKey) {
      const baselineCount = new Map();
      baseline.forEach((message) => baselineCount.set(message, (baselineCount.get(message) || 0) + 1));
      const fresh = latest.filter((message) => {
        const remaining = baselineCount.get(message) || 0;
        if (remaining > 0) {
          baselineCount.set(message, remaining - 1);
          return false;
        }
        return true;
      });
      return fresh.length ? fresh : latest.slice(-1);
    }
    await sleep(250);
  }
  return [];
}

async function processOneJob(task, resultRow, config) {
  if (runner.abort) return 'aborted';
  const job = { ...resultRow.job };
  if (!job.listHref && task.listHref) job.listHref = task.listHref;
  const item = ensureItem(task, job);
  const resumedFromChat = hasChatCheckpoint(item);
  if (resumedFromChat && item.triggerIdentity) Object.assign(job, item.triggerIdentity);
  resultRow.job = job;
  task.currentJobId = job.jobId;
  task.updatedAt = Date.now();
  await publishTask(task);

  if (runner.skipCurrent) {
    runner.skipCurrent = false;
    item.state = 'SKIPPED';
    item.reasons = [reasonText(REASON.EXEC_USER_SKIP)];
    task.counters.skipped += 1;
    await bumpDailyStat('skip');
    await log('warn', `跳过：${job.title}`, { jobId: job.jobId, reason: REASON.EXEC_USER_SKIP });
    return 'skipped';
  }

  // limits
  const todayStats = await getTodayStats();
  const limit = checkLimits({
    settings: config.settings,
    taskSuccessCount: task.counters.success,
    todayStats
  });
  if (!limit.ok) {
    await log('warn', limit.reasonTexts[0], { reason: limit.reasonCodes[0] });
    runner.pause = true;
    task.status = TASK_STATUS.PAUSED;
    task.pauseReason = limit.reasonTexts[0];
    await publishTask(task);
    return 'limited';
  }

  // 已创建沟通的重试必须从检查点继续；此时再做岗位去重会把当前岗位误判为已投。
  const history = await getHistory();
  const idempotency = await getIdempotencyMap();
  if (!resumedFromChat) {
    const dedup = checkDedup(job, {
      settings: config.settings,
      history,
      todayStats,
      taskItemKeys: new Set(
        task.items.filter((x) => x.state === 'COMPLETED' || x.state === 'SKIPPED').map((x) => x.jobId)
      ),
      idempotency
    });
    if (!dedup.ok) {
      item.state = 'SKIPPED';
      item.reasons = dedup.reasonTexts;
      task.counters.skipped += 1;
      await bumpDailyStat('skip');
      await log('info', `${job.title} - ${dedup.reasonTexts[0]}`, { jobId: job.jobId });
      return 'skipped';
    }
  } else {
    await log('info', `[任务] 从沟通检查点恢复：${item.phase}，不会再次点击「立即沟通」`, {
      jobId: job.jobId,
      triggeredAt: item.triggeredAt || null
    });
    await debugLog('background.task', 'chat_checkpoint_resume', {
      taskId: task.id,
      jobId: job.jobId,
      phase: item.phase,
      triggeredAt: item.triggeredAt || null,
      beforeKeyCount: item.beforeConversationKeys?.length || 0,
      triggerIdentity: item.triggerIdentity || null
    });
  }

  await log('info', `开始沟通：${job.title} @ ${job.company || ''}`, {
    jobId: job.jobId,
    href: String(job.href || '').slice(0, 180),
    securityId: job.securityId || '',
    listHref: String(job.listHref || task.listHref || '').slice(0, 120)
  });
  // version stamp for support
  // (content reports its version in START_CHAT response)



// 双页主路径直接在列表页触发沟通，避免预先 CLOSE/ENSURE 打乱虚拟列表。
    // 工作页直达岗位 href（列表页不动；正常路径不再 RETURN_TO_LIST 找下一岗）
  if (task.listHref && !job.listHref) job.listHref = task.listHref;
  await log('info', `[任务] 开始处理：${job.title} @ ${job.company || ''}`, {
    jobId: job.jobId,
    href: String(job.href || '').slice(0, 160),
    securityId: job.securityId || '',
    listHref: String(job.listHref || task.listHref || '').slice(0, 140)
  });

  // 三页主路径：左侧列表只读 + 临时执行页建会话 + 右侧消息页发送
  let listTabId = task.execution?.listTabId || null;
  if (!resumedFromChat) {
    let listTab = await ensureListTab(task);
    listTabId = listTab?.id || task.execution?.listTabId || null;
    if (!listTabId) {
      item.state = 'FAILED';
      item.reasons = ['未绑定列表页，请在职位列表页重新扫描预览'];
      task.counters.failed += 1;
      await log('error', '[列表页] 未找到列表标签页', { jobId: job.jobId });
      return 'failed';
    }
    if (!isBossJobListUrl(listTab?.url || listTab?.pendingUrl || '')) {
      const restored = await restoreListTabAfterTriggerNavigation(task, listTabId);
      if (!restored.ok) {
        item.state = 'FAILED';
        item.reasons = [restored.message || '未能恢复职位列表'];
        task.counters.failed += 1;
        task.pauseReason = item.reasons[0];
        await log('error', '[列表页] ' + item.reasons[0], { jobId: job.jobId, restored });
        return 'failed';
      }
      try { listTab = await chrome.tabs.get(listTabId); } catch (_) {}
    }
  }

  let messageTab;
  try {
    messageTab = await ensureMessageTab(task);
  } catch (e) {
    if (runner.abort || String(e?.message || e) === 'OP_CANCELLED') return 'aborted';
    item.state = 'FAILED';
    item.reasons = ['无法打开消息页：' + String(e?.message || e)];
    task.counters.failed += 1;
    await log('error', '[消息页] 创建失败：' + String(e?.message || e), { jobId: job.jobId });
    return 'failed';
  }
  if (runner.abort) return 'aborted';
  const msgTabId = messageTab.id;
  const msgOpt = { tabId: msgTabId, forceInject: true };
  // 每个岗位都校验缓存；从安全暂停恢复时也会在消息页重新读取，避免因旧失败快照反复暂停。
  await syncTaskBossGreeting(task, msgOpt);

  let beforeSnap = resumedFromChat
    ? { ok: true, keys: item.beforeConversationKeys || [], count: item.beforeConversationCount || 0 }
    : await sendToBoss(MSG.GET_CONVERSATION_SNAPSHOT || 'BHT_GET_CONVERSATION_SNAPSHOT', {}, msgOpt);
  if (operationAborted(beforeSnap)) return 'aborted';
  await log('info', `[消息页] ${resumedFromChat ? '恢复' : '沟通前'}会话快照 count=${beforeSnap?.count || 0}`, {
    href: beforeSnap?.href,
    beforeKeyCount: beforeSnap?.keys?.length || 0,
    sample: (beforeSnap?.items || []).slice(0, 3).map((x) => x.text)
  });

  let trig = item.triggerReceipt || { ok: true, already: true, contentVersion: '' };
  if (!resumedFromChat) {
    // 在临时后台执行页触发沟通；左侧真实列表不点击、不导航，完整保留 SPA 筛选和滚动位置。
    await log('info', '[执行页] 正在后台定位并触发沟通（左侧职位页保持不动）', {
      jobId: job.jobId,
      title: job.title,
      listTabId
    });
    trig = await triggerConversationInWorker(
      task,
      job,
      messageTab,
      listTabId,
      config.filters?.activeWithin || []
    );
    if (operationAborted(trig)) return 'aborted';
    await log(
      trig?.ok ? 'success' : (trig?.filtered ? 'info' : 'error'),
      trig?.ok
        ? ('[执行页] 已触发沟通 btn=' + (trig.buttonText || '') +
          (trig.navigated ? ' · BOSS 跳转发生在临时页（已关闭）' : (trig.stayed ? ' · 已点留在此页' : ' · 无需留在此页弹窗')) +
          (trig.listPreserved ? ' · 左侧筛选保持' : ' · 左侧页面需检查') +
          (trig.already ? ' · 继续沟通' : ''))
        : (trig?.filtered
          ? ('已跳过：' + (trig?.message || 'HR 活跃时间不满足'))
          : ('[执行页] 触发沟通失败：' + (trig?.message || trig?.error || ''))),
      {
        jobId: job.jobId,
        detailTitle: trig?.detailTitle,
        samples: trig?.samples,
        workerMode: trig?.workerMode,
        listPreserved: trig?.listPreserved,
        workerAttempts: trig?.workerAttempts
      }
    );
    if (!trig?.ok) {
      if (trig?.filtered === true && trig?.error === REASON.FILTER_ACTIVE) {
        job.activeText = String(trig.activeText || '');
        // 预览行同步为「投递跳过」：该岗位在投递时因 HR 活跃不匹配被跳过，不被计入投递
        const skipReason = `投递跳过：HR活跃度为「${job.activeText || '未知'}」不匹配`;
        resultRow.job = job;
        const previewRow = (task.results || []).find((r) => r.job?.jobId === job.jobId);
        if (previewRow) {
          previewRow.job = { ...previewRow.job, ...job };
          previewRow.passReasons = [skipReason];
        }
        item.state = 'SKIPPED';
        item.reasons = [skipReason];
        task.counters.skipped += 1;
        await bumpDailyStat('skip');
        await log('info', `${job.title} - ${item.reasons[0]}`, {
          jobId: job.jobId,
          activeText: job.activeText || '',
          activityCheckedBeforeClick: true
        });
        return 'skipped';
      }
      item.state = /LIST_JOB_NOT_FOUND|找不到/.test(String(trig?.error || '')) ? 'SKIPPED' : 'FAILED';
      item.reasons = [trig?.message || trig?.error || '列表页触发沟通失败'];
      if (item.state === 'SKIPPED') {
        task.counters.skipped += 1;
        await appendHistory({ jobId: job.jobId, title: job.title, company: job.company, status: 'skipped_list', taskId: task.id });
        return 'skipped';
      }
      task.counters.failed += 1;
      task.consecutiveFails += 1;
      task.pauseReason = item.reasons[0];
      return 'failed';
    }

    // 列表详情拿到的 HR/公司/岗位，合并进 job，供消息页「公司+HR+岗位」匹配
    if (trig.hrName || trig.bossName) {
      job.hrName = trig.hrName || trig.bossName;
      job.bossName = trig.hrName || trig.bossName;
    }
    if (trig.company) job.company = job.company || trig.company;
    if (trig.title || trig.detailTitle) job.title = job.title || trig.title || trig.detailTitle;
    await log('info', '[列表页] 沟通对象身份：HR=' + (job.hrName || '未知') + ' · 公司=' + (job.company || '') + ' · 岗位=' + String(job.title || '').slice(0, 40), {
      jobId: job.jobId,
      hrName: job.hrName || '',
      company: job.company || '',
      title: job.title || ''
    });

    item.phase = JOB_PHASE.CHAT_TRIGGERED;
    item.triggeredAt = Date.now();
    item.beforeConversationKeys = [...new Set(beforeSnap?.keys || [])].slice(0, 160);
    item.beforeConversationCount = Number(beforeSnap?.count || item.beforeConversationKeys.length || 0);
    item.triggerIdentity = {
      hrName: job.hrName || '',
      bossName: job.bossName || job.hrName || '',
      company: job.company || '',
      title: job.title || ''
    };
    item.triggerReceipt = {
      ok: true,
      already: Boolean(trig.already),
      buttonText: trig.buttonText || '',
      stayed: Boolean(trig.stayed),
      nativeGreeting: trig.nativeGreeting || null,
      workerMode: trig.workerMode || '',
      listPreserved: trig.listPreserved === true,
      contentVersion: trig.contentVersion || ''
    };
    resultRow.job = job;
    task.updatedAt = Date.now();
    await publishTask(task);
    await debugLog('background.task', 'chat_checkpoint_saved', {
      taskId: task.id,
      jobId: job.jobId,
      phase: item.phase,
      beforeKeyCount: item.beforeConversationKeys.length,
      triggerIdentity: item.triggerIdentity
    });

  }

  // 创建会话成功回执到消息列表可见之间存在短暂传播延迟；稍等后再刷新，避免刷新得比新会话入库更早。
  if (!resumedFromChat) await sleep(700);
  const refreshResult = await refreshMessageTabOnce(task, msgTabId, {
    jobId: job.jobId,
    resumed: resumedFromChat
  });
  if (operationAborted(refreshResult)) return 'aborted';

  // 消息页阶段一：解析并打开会话（不含输入框门禁）
  if (runner.abort) return 'aborted';
  try { await chrome.tabs.update(msgTabId, { active: true }); } catch (_) {}
  await sleep(400);
  if (runner.abort) return 'aborted';
  await log('info', '[消息页] 等待并匹配会话…', { jobId: job.jobId, company: job.company, title: job.title });
  let conv = await sendToBoss(
    MSG.WAIT_OPEN_CONVERSATION || 'BHT_WAIT_OPEN_CONVERSATION',
    { job, beforeKeys: beforeSnap?.keys || [], timeoutMs: 9000 },
    msgOpt
  );
  if (operationAborted(conv)) return 'aborted';
  if (!conv?.ok && conv?.error === 'CONVERSATION_NOT_FOUND') {
    await log('info', '[消息页] 首次刷新后暂未出现新会话，正在执行第二次刷新…', {
      jobId: job.jobId,
      company: job.company,
      title: job.title
    });
    await sleep(700);
    if (runner.abort) return 'aborted';
    const secondRefresh = await refreshMessageTabOnce(task, msgTabId, {
      jobId: job.jobId,
      resumed: false
    });
    if (operationAborted(secondRefresh)) return 'aborted';
    try { await chrome.tabs.update(msgTabId, { active: true }); } catch (_) {}
    conv = await sendToBoss(
      MSG.WAIT_OPEN_CONVERSATION || 'BHT_WAIT_OPEN_CONVERSATION',
      { job, beforeKeys: beforeSnap?.keys || [], timeoutMs: 14000 },
      msgOpt
    );
    if (operationAborted(conv)) return 'aborted';
  }
  await log(
    conv?.ok ? 'success' : 'error',
    conv?.ok
      ? ('[消息页] 会话打开确认 via=' + (conv.matchedVia || '') + ' · ' + String(conv.conversationText || conv.active?.text || '').slice(0, 60))
      : ('[消息页] 会话打开失败：' + (conv?.error || '') + ' · ' + (conv?.message || '')),
    { jobId: job.jobId, sample: conv?.sample, head: conv?.active?.head || conv?.head, before: conv?.before, after: conv?.after }
  );

  if (!conv?.ok) {
    const convErr = String(conv?.error || '');
    const convMsg = String(conv?.message || '');
    const unsafe =
      /AMBIGUOUS|IDENTITY_MISMATCH|OPEN_NOT_CONFIRMED|ELEMENT_NOT_FOUND/i.test(convErr) ||
      /未确认切换|不匹配|多个相似会话/.test(convMsg);
    if (unsafe) {
      item.state = 'FAILED';
      item.reasons = [conv.message || conv.error || '会话打开未确认'];
      task.counters.failed += 1;
      task.pauseReason = item.reasons[0];
      task.awaitingUserRetry = true;
      runner.pause = true;
      task.status = TASK_STATUS.PAUSED;
      await publishTask(task);
      await log('error', '[消息页] 会话未可靠打开，已暂停（不会当未找到会话跳过）：' + (conv.error || conv.message || ''), {
        jobId: job.jobId,
        top: conv.top,
        diagnostic: conv.diagnostic
      });
      return 'failed';
    }
    // 真没找到会话才 skip
    item.state = 'SKIPPED';
    item.reasons = [conv?.message || '未找到会话'];
    task.counters.skipped += 1;
    await appendHistory({ jobId: job.jobId, title: job.title, company: job.company, status: 'conversation_not_found', taskId: task.id, phase: 'CHAT_TRIGGERED' });
    await log('warn', '[任务] 跳过：' + (conv?.error || 'CONVERSATION_NOT_FOUND') + ' · ' + (job.title || '') + '（列表侧可能已点过沟通）', { jobId: job.jobId });
    return 'skipped';
  }

  item.phase = JOB_PHASE.CONVERSATION_OPENED;
  task.updatedAt = Date.now();
  await publishTask(task);

  // 消息页阶段二：等待输入框（失败=暂停，绝不当成未找到会话）
  await log('info', '[消息页] 等待聊天输入框…', { jobId: job.jobId });
  try { await chrome.tabs.update(msgTabId, { active: true }); } catch (_) {}
  let editor = await sendToBoss(
    MSG.WAIT_CHAT_EDITOR || 'BHT_WAIT_CHAT_EDITOR',
    { timeoutMs: 30000 },
    msgOpt
  );
  if (operationAborted(editor)) return 'aborted';
  await log(
    editor?.ok ? 'success' : 'error',
    editor?.ok
      ? '[消息页] 输入框已就绪'
      : ('[消息页] 编辑器未就绪：' + (editor?.message || editor?.error || '')),
    { jobId: job.jobId, diagnostic: editor?.diagnostic }
  );
  if (!editor?.ok) {
    item.state = 'FAILED';
    item.reasons = [editor?.message || 'CHAT_EDITOR_NOT_READY'];
    item.phase = JOB_PHASE.CONVERSATION_OPENED_EDITOR_PENDING;
    task.counters.failed += 1;
    task.pauseReason = '会话已打开，但消息输入框未识别，请检查消息页后点重试';
    task.awaitingUserRetry = true;
    task.lastErrorDetail = JSON.stringify(editor?.diagnostic || {}, null, 0).slice(0, 800);
    runner.pause = true;
    task.status = TASK_STATUS.PAUSED;
    await publishTask(task);
    await log('error', '[消息页] 会话已打开但编辑器未就绪，任务已暂停（不会跳过该岗位）', {
      jobId: job.jobId,
      diagnostic: editor?.diagnostic
    });
    return 'failed';
  }

  const chatRes = {
    ok: true,
    already: Boolean(trig.already),
    matchedVia: 'list-trigger+' + (conv.matchedVia || 'msg'),
    contentVersion: conv.contentVersion || editor.contentVersion || trig.contentVersion,
    job
  };
  const tabOpt = msgOpt;
  // 下面继续原有发消息/简历逻辑（使用消息页 tabOpt）

  if (!chatRes?.ok) {
    item.state = 'FAILED';
    let code = REASON.EXEC_CLICK_FAIL;
    if (chatRes?.error === 'CHAT_TIMEOUT') code = REASON.EXEC_CHAT_TIMEOUT;
    if (chatRes?.error === 'LOGIN_REQUIRED') code = REASON.LIMIT_PLATFORM;
    item.reasons = [reasonText(code, chatRes?.message || chatRes?.error || '')];
    task.pauseReason = item.reasons[0];
    task.lastErrorDetail = '岗位：' + (job.title || '') + ' @ ' + (job.company || '');
    task.counters.failed += 1;
    task.consecutiveFails += 1;
    await bumpDailyStat('fail');
    await log('error', `沟通失败：${item.reasons[0]}`, {
      jobId: job.jobId,
      error: chatRes?.error,
      samples: chatRes?.samples,
      listCount: chatRes?.listCount,
      page: chatRes?.href
    });
    if (chatRes?.error === 'LOGIN_REQUIRED') {
      runner.pause = true;
      task.awaitingUserRetry = true;
      task.status = TASK_STATUS.PAUSED;
      task.pauseReason = chatRes.message || '请先登录 BOSS 直聘后再投递';
      await publishTask(task);
      // LOGIN_REQUIRED_USER_HINT
      await log('error', task.pauseReason + '（任务已停止）', { jobId: job.jobId });
      return 'limited';
    }
    // RETURN_TO_LIST after fail
    await softReturnToList(task);
    if (/找不到该岗位|列表中找不到|JOB_NOT_FOUND|LIST_NOT_READY/i.test(String(chatRes?.error || '') + String(chatRes?.message || ''))) {
      item.state = 'SKIPPED';
      item.reasons = [chatRes?.message || '列表中找不到该岗位，已跳过并继续下一岗'];
      task.counters.skipped += 1;
      task.consecutiveFails = Math.min(Number(task.consecutiveFails || 0), 1);
      await appendHistory({
        jobId: job.jobId,
        company: job.company,
        title: job.title,
        status: 'skipped_missing',
        taskId: task.id,
        message: chatRes?.message || ''
      });
      await log('warn', '跳过无法定位的岗位，继续队列下一岗：' + (job.title || ''), { jobId: job.jobId });
      return 'skipped';
    }
    return 'failed';
  }
  if (chatRes.job) {
    Object.assign(job, chatRes.job);
    resultRow.job = job;
  }
  if (chatRes.securityId) job.securityId = chatRes.securityId;
  if (chatRes.detailSalary && !job.salary) job.salary = chatRes.detailSalary;

  item.state = 'COMMUNICATION_CREATED';
  await bumpDailyStat('communicate', 1, normalizeMatchText(job.company || ''));
  await log('success', '已进入沟通，开始发送消息', {
    jobId: job.jobId,
    matchedVia: chatRes?.matchedVia,
    conversation: conv?.conversationText || conv?.active?.text || '',
    head: conv?.active?.head || ''
  });

  // messages
  const selfRes = await sendToBoss(MSG.GET_CHAT_SELF_MESSAGES, { limit: 8 }, tabOpt);
  if (operationAborted(selfRes)) return 'aborted';
  let recentSelfMessages = selfRes?.messages || [];
  const platformReceipt = trig?.nativeGreeting || item.triggerReceipt?.nativeGreeting || null;
  const settingSnapshot = task.bossGreetingSnapshot?.ok ? task.bossGreetingSnapshot : null;
  let nativeEvidence = resolveNativeGreetingEvidence({
    platformReceipt,
    settingSnapshot,
    alreadyContacted: Boolean(trig?.already),
    freshSelfMessages: []
  });
  if (
    nativeEvidence.state === NATIVE_GREETING_STATES.UNKNOWN &&
    config.settings.pluginTextEnabled !== false &&
    !trig?.already
  ) {
    recentSelfMessages = await waitForFreshSelfMessages(
      tabOpt,
      recentSelfMessages,
      Number(config.settings.nativeGreetingWaitMs || 2600)
    );
    nativeEvidence = resolveNativeGreetingEvidence({
      platformReceipt,
      settingSnapshot,
      alreadyContacted: false,
      freshSelfMessages: recentSelfMessages
    });
  }
  item.nativeGreetingEvidence = nativeEvidence;
  task.nativeGreetingEvidence = nativeEvidence;
  await log(
    nativeEvidence.state === NATIVE_GREETING_STATES.UNKNOWN ? 'warn' : 'info',
    '原生招呼判断：' + nativeEvidence.state + ' via=' + nativeEvidence.source +
      (nativeEvidence.text ? (' · ' + nativeEvidence.text.slice(0, 60)) : ''),
    { jobId: job.jobId, nativeEvidence, platformReceipt, settingSnapshot }
  );
  const plan = planMessageSegments({
    mode: config.settings.messageMode,
    template: config.messageTemplate,
    job: {
      ...job,
      hrName: job.hrName || 'HR',
      city: job.location
    },
    recentSelfMessages,
    threshold: config.settings.similarityThreshold,
    idempotency,
    nativeGreetingState: nativeEvidence.state,
    strictUnknown: config.settings.strictGreetingGuard !== false,
    pluginTextEnabled: config.settings.pluginTextEnabled !== false
  });

  if (plan.blocked) {
    item.state = 'PAUSED';
    item.reasons = ['无法确认 BOSS 是否已发送自动招呼，已暂停以避免重复。请同步 BOSS 招呼状态后重试'];
    runner.pause = true;
    task.status = TASK_STATUS.PAUSED;
    task.awaitingUserRetry = true;
    task.pauseReason = item.reasons[0];
    task.lastErrorDetail = '岗位：' + (job.title || '') + ' @ ' + (job.company || '') + '\n判断来源：' + nativeEvidence.source;
    await publishTask(task);
    await log('warn', item.reasons[0], { jobId: job.jobId, nativeEvidence });
    return 'limited';
  }
  if (plan.nativeDetected) {
    item.state = 'NATIVE_GREETING_DETECTED';
    await log('info', '检测到 BOSS 已发送招呼，跳过插件招呼段，仅发送补充段', { jobId: job.jobId, nativeEvidence });
  }
  if (!plan.plan?.length) {
    await log('warn', '没有待发送的消息段（可能都被跳过或模板为空），将继续尝试简历发送', { jobId: job.jobId });
  } else {
    await log('info', '准备发送 ' + plan.plan.length + ' 段消息', { jobId: job.jobId });
  }

  for (const step of plan.plan) {
    await waitWhilePaused();
    if (runner.abort) return 'aborted';
    if (runner.skipCurrent) break;

    if (!step.render.ok) {
      item.state = 'FAILED';
      item.reasons = step.render.reasonTexts;
      task.counters.failed += 1;
      task.consecutiveFails += 1;
      await bumpDailyStat('fail');
      await log('error', step.render.reasonTexts[0], { jobId: job.jobId });
      return 'failed';
    }

    if (await hasIdempotent(step.key)) continue;

    await log('info', '准备发送第 ' + (step.index + 1) + ' 段（' + String(step.text || '').slice(0, 40) + '…）', { jobId: job.jobId, tabId: tabOpt?.tabId });
    const sendResult = await sendToBoss(MSG.SEND_TEXT, {
      text: step.text,
      jobId: job.jobId,
      segmentIndex: step.index,
      conversationKey: conv?.active?.key || ''
    }, tabOpt);
    if (operationAborted(sendResult)) return 'aborted';
    const receiptConfirmed =
      sendResult?.ok === true &&
      sendResult?.confirmed === true &&
      sendResult?.receipt?.type === 'TEXT_SENT' &&
      sendResult?.receipt?.status === 'confirmed';
    const sendRes = receiptConfirmed
      ? sendResult
      : {
          ...(sendResult || {}),
          ok: false,
          error: sendResult?.error || 'SEND_NOT_CONFIRMED',
          message: sendResult?.message || '页面没有返回可验证的发送回执'
        };
    await log(sendRes?.ok ? 'success' : 'error',
      sendRes?.ok ? ('第 ' + (step.index + 1) + ' 段发送确认') : ('第 ' + (step.index + 1) + ' 段失败：' + (sendRes?.message || sendRes?.error || '')),
      { jobId: job.jobId, receiptId: sendRes?.receipt?.receiptId || '' });
    if (!sendRes?.ok) {
      item.state = 'FAILED';
      let sendCode = REASON.EXEC_SEND_TEXT_FAIL;
      if (sendRes?.error === 'LOGIN_REQUIRED') sendCode = REASON.LIMIT_PLATFORM;
      if (sendRes?.error === 'CHAT_TIMEOUT' || sendRes?.error === 'INPUT_NOT_FOUND') sendCode = REASON.EXEC_CHAT_TIMEOUT;
      item.reasons = [reasonText(sendCode, sendRes?.message || sendRes?.error || '')];
      task.pauseReason = item.reasons[0];
      task.lastErrorDetail = '岗位：' + (job.title || '') + ' @ ' + (job.company || '') + '\n发送内容：' + String(step.text || '').slice(0, 80);
      task.counters.failed += 1;
      task.consecutiveFails += 1;
      await bumpDailyStat('fail');
      await log('error', '发送失败：' + (job.title || '') + ' - ' + item.reasons[0], { jobId: job.jobId });
      if (sendRes?.error === 'LOGIN_REQUIRED') {
        runner.pause = true;
        task.awaitingUserRetry = true;
        task.status = TASK_STATUS.PAUSED;
        await publishTask(task);
        await log('error', task.pauseReason + '（任务已停止）', { jobId: job.jobId });
        return 'limited';
      }
      // RETURN_TO_LIST after send fail
      await softReturnToList(task);
      return 'failed';
    }

    await markIdempotent(step.key, { jobId: job.jobId, segment: step.index });
    item.receipts = Array.isArray(item.receipts) ? item.receipts : [];
    item.receipts.push(sendRes.receipt);
    item.receipts = item.receipts.slice(-20);
    item.lastReceipt = sendRes.receipt;
    task.lastReceipt = sendRes.receipt;
    item.state = step.stateName;
    task.updatedAt = Date.now();
    await publishTask(task);
    await log('success', `已发送第 ${step.index + 1} 段消息`, {
      jobId: job.jobId,
      receiptId: sendRes.receipt.receiptId
    });
    await sleep(randomBetween(config.settings.segmentIntervalMs));
  }

  // resume: re-check controls after last text segment
  await waitWhilePaused();
  if (runner.abort) return 'aborted';
  if (runner.skipCurrent) {
    runner.skipCurrent = false;
    item.state = 'SKIPPED';
    item.reasons = [reasonText(REASON.EXEC_USER_SKIP)];
    task.counters.skipped += 1;
    await bumpDailyStat('skip');
    await log('warn', `跳过：${job.title}`, { jobId: job.jobId, reason: REASON.EXEC_USER_SKIP });
    return 'skipped';
  }

  // resume
  const profile = pickResumeProfile(job, config.resumes, config.bindings);
  const resumeImages = dedupeResumeImages(profile?.images);
  const hasImages = resumeImages.length > 0;
  const {
    timing,
    flagImage,
    wantAutoImage,
    doResume
  } = planResumeSend({ settings: config.settings, hasImages });
  if (!doResume) {
    let why = '';
    if (timing !== 'after_text') why = '发送时机不是「文本发送完成后立即发送」';
    else if (!flagImage) why = '未启用图片简历';
    else if (!hasImages) why = '已启用图片简历，但当前方案中无图片';
    else why = '当前配置不满足自动发简历条件';
    await log('info', '本次不自动发送简历：' + why, {
      jobId: job.jobId,
      timing,
      flagImage,
      hasImages,
      profileId: profile?.id || null
    });
  } else {
    await log('info', '将自动发送图片简历：' + resumeImages.length + '张', {
      jobId: job.jobId,
      profileId: profile?.id || null
    });
  }

  if (doResume) {
    if (wantAutoImage) {
      for (let i = 0; i < resumeImages.length; i++) {
        const img = resumeImages[i];
        const key = resumeIdempotencyKey(job, `image_${i}`, profile.id);
        if (await hasIdempotent(key)) continue;
        const imgRes = await sendToBoss(MSG.SEND_IMAGE, {
          dataUrl: img.dataUrl,
          fileName: img.name || `resume_${i + 1}.png`
        }, tabOpt);
        if (operationAborted(imgRes)) return 'aborted';
        const imageConfirmed =
          imgRes?.ok === true &&
          imgRes?.confirmed === true &&
          imgRes?.receipt?.type === 'IMAGE_SENT' &&
          imgRes?.receipt?.status === 'confirmed';
        if (!imageConfirmed) {
          item.state = 'FAILED';
          item.reasons = [reasonText(REASON.EXEC_SEND_IMAGE_FAIL, imgRes?.message || imgRes?.error || '图片发送未确认')];
          task.pauseReason = item.reasons[0];
          task.lastErrorDetail = '岗位：' + (job.title || '') + ' @ ' + (job.company || '') + '\n图片简历发送未确认';
          task.counters.failed += 1;
          task.consecutiveFails += 1;
          await bumpDailyStat('fail');
          await log('error', `图片简历发送失败：${imgRes?.message || imgRes?.error || '未确认'}`, { jobId: job.jobId });
          return 'failed';
        }
        await markIdempotent(key, { jobId: job.jobId });
        item.state = 'IMAGE_RESUME_SENT';
        item.receipts = Array.isArray(item.receipts) ? item.receipts : [];
        item.receipts.push(imgRes.receipt);
        item.lastReceipt = imgRes.receipt;
        task.lastReceipt = imgRes.receipt;
        await log('success', `图片简历已发送 ${i + 1}/${resumeImages.length}`, {
          jobId: job.jobId,
          receiptId: imgRes.receipt.receiptId,
          confirmedVia: imgRes.receipt.confirmedVia
        });
        await sleep(randomBetween(config.settings.segmentIntervalMs));
      }
    }
  }

  if (runner.skipCurrent) {
    runner.skipCurrent = false;
    item.state = 'SKIPPED';
    item.reasons = [reasonText(REASON.EXEC_USER_SKIP)];
    task.counters.skipped += 1;
    await bumpDailyStat('skip');
    return 'skipped';
  }

  // 返回列表统一由 runTaskLoop 负责（避免双重 RETURN 打乱列表）
  item.state = 'COMPLETED';
  item.reasons = [reasonText(REASON.OK_ITEM_COMPLETED)];
  item.completionSignal = {
    type: 'JOB_COMPLETED',
    status: 'confirmed',
    receiptId: uid('job_done'),
    jobId: job.jobId,
    conversationKey: item.lastReceipt?.conversationKey || conv?.active?.key || '',
    textReceipts: (item.receipts || []).map((receipt) => receipt.receiptId),
    completedAt: Date.now()
  };
  task.counters.success += 1;
  task.consecutiveFails = 0;
  await bumpDailyStat('success');
  await markIdempotent(jobIdempotencyKey(job), { jobId: job.jobId });
  await appendHistory({
    jobId: job.jobId,
    bossId: job.bossId,
    company: job.company,
    title: job.title,
    securityId: job.securityId,
    status: 'success',
    taskId: task.id
  });
  await log('success', `完成：${job.title}`, { jobId: job.jobId });
  return 'success';
}

async function runTaskLoop(taskId) {
  if (runner.running) return { ok: false, error: 'ALREADY_RUNNING' };
  runner.running = true;
  runner.abort = false;
  runner.pause = false;
  runner.skipCurrent = false;
  runner.pauseLogged = false;
  runner.pausePublished = false;

  try {
    let config = await getAllConfig();
    let task = config.task;
    if (!task || task.id !== taskId) {
      return { ok: false, error: 'TASK_NOT_FOUND' };
    }

    task.status = TASK_STATUS.RUNNING;
    task.updatedAt = Date.now();
    await publishTask(task);

    // 队列以预览快照为准（不是回页后再猜）
    // 始终按 selected 重建 pending 视图，并去重
    {
      const rebuilt = buildDeliveryQueue(task.results || [], { selectedOnly: true });
      // 保留已完成状态
      const prev = new Map((task.queue || []).map((q) => [String(q.jobId || '') + '|' + normalizeText(q.title || ''), q]));
      task.queue = rebuilt.map((q) => {
        const old = prev.get(String(q.jobId || '') + '|' + normalizeText(q.title || '')) ||
          (task.queue || []).find((x) => x.jobId && x.jobId === q.jobId);
        if (old && (old.status === 'done' || old.status === 'skipped' || old.status === 'failed')) {
          return { ...q, status: old.status, outcome: old.outcome, finishedAt: old.finishedAt };
        }
        return q;
      });
      if (task.queueCursor == null) task.queueCursor = 0;
      await publishTask(task);
    }
    const queue = task.queue.map((q) => {
      const row = (task.results || []).find((r) => r.job?.jobId === q.jobId);
      return row || {
        decision: 'pass',
        selected: true,
        job: {
          jobId: q.jobId,
          title: q.title,
          company: q.company,
          href: q.href,
          securityId: q.securityId,
          listHref: task.listHref
        }
      };
    });
    await log('info', '开始队列投递：共 ' + queue.length + ' 岗；锚点 ' + String(task.listHref || '无').slice(0, 120) + (task.listExpectLabel ? ('；求职期望 ' + String(task.listExpectLabel).slice(0, 40)) : ''));

    for (let qi = 0; qi < queue.length; qi++) {
      const row = queue[qi];
      await waitWhilePaused();
      if (runner.abort) break;

      // refresh config each item for live setting changes
      config = await getAllConfig();
      task = config.task;
      if (!task) break;

      // 持久化游标：queue 状态优先（SW 重启后仍能续跑）
      const qMeta = (task.queue || [])[qi] || (task.queue || []).find((x) => x.jobId === row.job?.jobId);
      if (qMeta && (qMeta.status === 'done' || qMeta.status === 'skipped' || qMeta.status === 'failed' && qMeta.skipOnResume)) {
        continue;
      }
      const item = task.items.find((x) => x.jobId === row.job.jobId);
      if (item && (item.state === 'COMPLETED' || item.state === 'SKIPPED')) {
        if (qMeta && qMeta.status === 'pending') {
          qMeta.status = item.state === 'COMPLETED' ? 'done' : 'skipped';
          await publishTask(task);
        }
        continue;
      }
      // 写入 nextJobId 便于恢复
      task.nextJobId = row.job?.jobId || null;
      task.currentJobId = row.job?.jobId || null;

      task.queueCursor = qi;
      await publishTask(task);
      await log('info', '队列进度 ' + (qi + 1) + '/' + queue.length + '：' + (row.job?.title || '') + ' @ ' + (row.job?.company || ''), {
        jobId: row.job?.jobId
      });
      // 回列表改在 processOneJob 之后统一做一次

      // assertBossContext before process
      {
        let guard = await assertBossContext();
        if (!guard.ok && task.execution?.listTabId) {
          try {
            const listTab = await chrome.tabs.get(task.execution.listTabId);
            if (isBossTab(listTab)) guard = { ok: true, tab: listTab };
          } catch (_) {}
        }
        if (!guard.ok) {
          runner.pause = true;
          task.status = TASK_STATUS.PAUSED;
          task.pauseReason = guard.message;
          await publishTask(task);
          await log("warn", guard.message);
          break;
        }
      }
      let outcome = await processOneJob(task, row, config);
      // processOneJob 会更新 item/reasons/counters；必须先持久化再重新读取配置，
      // 否则失败计数和具体原因会被旧 storage 快照覆盖成 0/空。
      task.updatedAt = Date.now();
      await publishTask(task);
      await debugLog('background.task', 'job_process_returned', {
        taskId: task.id,
        jobId: row.job?.jobId || '',
        outcome,
        counters: task.counters,
        item: task.items?.find((entry) => entry.jobId === row.job?.jobId) || null,
        pauseReason: task.pauseReason || ''
      }, outcome === 'failed' ? 'error' : 'debug');
      try {
        config = await getAllConfig();
        task = config.task || task;
        if (task?.queue) {
          const q = task.queue.find((x) => x.jobId === row.job?.jobId);
          if (q) {
            q.status = outcome === 'success'
              ? 'done'
              : outcome === 'skipped'
                ? 'skipped'
                : outcome === 'limited' || outcome === 'aborted'
                  ? 'pending'
                  : 'failed';
            if (q.status === 'pending') delete q.finishedAt;
            else q.finishedAt = Date.now();
            q.outcome = outcome;
          }
          // 一份一份投：成功/跳过/失败都记入已投，避免下一轮又点回同一岗
          if (row.job?.jobId && (outcome === 'success' || outcome === 'skipped' || outcome === 'failed')) {
            const id = String(row.job.jobId);
            const prev = Array.isArray(task.testedJobIds) ? task.testedJobIds.map(String) : [];
            if (!prev.includes(id)) task.testedJobIds = [...prev, id];
          }
          await publishTask(task);
        }
        await log('info', '队列项结果：' + (row.job?.title || '') + ' → ' + outcome + '（' + (qi + 1) + '/' + queue.length + '）', { jobId: row.job?.jobId });
      } catch (_) {}

      // 投递一份：跳过（含 HR 活跃不满足）不算投递，自动顺延下一个待投；遇到满足的投递成功即停
      if (task.testDelivery && outcome === 'skipped') {
        const nextPick = pickNextTestDeliveryJob({
          results: task.results || [],
          items: task.items || [],
          queue: task.queue || [],
          extraDoneIds: task.testedJobIds || []
        });
        if (nextPick.ok && nextPick.pick?.job?.jobId) {
          const nextId = String(nextPick.pick.job.jobId);
          task.queue = [...(task.queue || [])];
          if (!task.queue.some((x) => String(x.jobId || '') === nextId)) {
            task.queue.push({
              index: task.queue.length,
              jobId: nextId,
              title: nextPick.pick.job.title || '',
              company: nextPick.pick.job.company || '',
              href: nextPick.pick.job.href || '',
              securityId: nextPick.pick.job.securityId || '',
              status: 'pending'
            });
          }
          queue.push({
            decision: 'pass',
            selected: true,
            job: {
              jobId: nextId,
              title: nextPick.pick.job.title || '',
              company: nextPick.pick.job.company || '',
              href: nextPick.pick.job.href || '',
              securityId: nextPick.pick.job.securityId || '',
              listHref: task.listHref
            }
          });
          await publishTask(task);
          await log('info', `[投递一份] 已跳过（不计入投递），顺延下一岗「${nextPick.pick.job.title || ''}」@ ${nextPick.pick.job.company || ''}`, { jobId: nextId });
          continue;
        }
      }
      if (task.testDelivery && outcome === 'success') break;

      // 失败后等待用户：关闭=保持暂停不自动继续；重试=重置当前岗位后再跑一次
      while (outcome === 'failed') {
        if (runner.abort) {
          outcome = 'aborted';
          break;
        }
        // 回列表，避免卡在会话页
        try { await softReturnToList(task); } catch (_) {}
        await sleep(400);

        config = await getAllConfig();
        task = config.task;
        if (!task) break;

        task.status = TASK_STATUS.PAUSED;
        task.awaitingUserRetry = true;
        task.uiErrorDismissed = false;
        task.retryCurrent = false;
        task.pauseReason = task.pauseReason || itemErrorHint(task, row) || '岗位处理失败，请查看原因后重试';
        task.errorKey = [task.id || '', row.job?.jobId || '', task.pauseReason || ''].join('|');
        task.lastErrorDetail = ['岗位：' + (row.job?.title || ''), '公司：' + (row.job?.company || ''), '原因：' + ((task.items.find((x) => x.jobId === row.job.jobId) || {}).reasons || []).join('；')].filter(Boolean).join('\n');
        runner.pause = true;
        await publishTask(task);
        await waitWhilePaused();
        if (runner.abort) {
          outcome = 'aborted';
          break;
        }

        config = await getAllConfig();
        task = config.task;
        if (!task) break;
        const it = task.items?.find((x) => x.jobId === row.job.jobId);
        if (it && it.state === 'NOT_STARTED' && task.retryCurrent === true) {
          // 用户点了重试：再试当前岗位
          task.retryCurrent = false;
          await publishTask(task);
          outcome = await processOneJob(task, row, config);
          task.updatedAt = Date.now();
          await publishTask(task);
          await debugLog('background.task', 'job_retry_returned', {
            taskId: task.id,
            jobId: row.job?.jobId || '',
            outcome,
            counters: task.counters,
            item: task.items?.find((entry) => entry.jobId === row.job?.jobId) || null
          }, outcome === 'failed' ? 'error' : 'debug');
          continue;
        }
        // 用户关闭后点继续：不重试当前失败项，进入下一岗
        task.retryCurrent = false;
        task.awaitingUserRetry = false;
        // 手动继续时不把历史失败累计成自动熔断
        task.consecutiveFails = 0;
        await publishTask(task);
        break;
      }

      if (outcome === 'limited') break;
      if (outcome === 'aborted') break;

      // 双页模式：工作页直接打开下一岗 href，正常路径不再 RETURN_TO_LIST
      // （失败暂停时 while 里仍会尝试回列表，便于用户操作）
      task.counters.processed += 1;
      task.updatedAt = Date.now();
      await publishTask(task);

      if (task.consecutiveFails >= (config.settings.consecutiveFailPause || 3)) {
        task.status = TASK_STATUS.PAUSED;
        task.pauseReason = reasonText(REASON.EXEC_CONSECUTIVE_FAIL);
        runner.pause = true;
        await publishTask(task);
        if (!runner.pauseLogged) { runner.pauseLogged = true; await log('error', task.pauseReason); }
        break;
      }

      // minJobInterval guard
      {
        let iv = config.settings.jobIntervalMs || [4000, 6000];
        if (Array.isArray(iv) && iv[0] < 1000) iv = [4000, 6000];
        await sleep(randomBetween(iv));
      }
    }

    config = await getAllConfig();
    task = config.task;
    if (task) {
      if (runner.abort) {
        task.status = TASK_STATUS.STOPPED;
        setTaskTerminalSignal(task, TASK_STATUS.STOPPED);
        await log('warn', taskSummaryText(task, TASK_STATUS.STOPPED));
      } else if (task.status === TASK_STATUS.PAUSED || runner.pause) {
        task.status = TASK_STATUS.PAUSED;
        await log('warn', task.pauseReason || '任务已暂停');
      } else {
        task.status = TASK_STATUS.COMPLETED;
        setTaskTerminalSignal(task, TASK_STATUS.COMPLETED);
        await log('success', taskSummaryText(task, TASK_STATUS.COMPLETED));
      }
      // 单份投完后：自动勾选剩余未投通过岗，便于立刻「批量投递」
      if (task.testDelivery || task.testJobId) {
        const done = collectDoneJobIds(task.items, task.queue, task.testedJobIds);
        task.results = (task.results || []).map((r) => ({
          ...r,
          selected: r?.decision === 'pass' && r?.job?.jobId && !done.has(String(r.job.jobId))
        }));
        const remain = new Set(
          (task.results || [])
            .filter((r) => r?.selected && r?.job?.jobId)
            .map((r) => String(r.job.jobId))
        );
        task.items = (task.items || []).map((it) => ({
          ...it,
          selected: remain.has(String(it.jobId || ''))
        }));
        // 结束单份标记，但保留 testedJobIds 供后续去重
        task.testDelivery = false;
        task.testJobId = null;
      }
      task.updatedAt = Date.now();
      task.currentJobId = null;
      await publishTask(task);
    }
    return { ok: true, task };
  } catch (err) {
    await debugLog('background.task', 'runner_exception', { taskId, error: serializeError(err) }, 'error');
    await log('error', `任务异常：${err?.message || err}`, { error: serializeError(err) });
    const config = await getAllConfig();
    if (config.task) {
      config.task.status = TASK_STATUS.FAILED;
      config.task.updatedAt = Date.now();
      await publishTask(config.task);
    }
    return { ok: false, error: String(err?.message || err) };
  } finally {
    try {
      const all = await getAllConfig();
      if (all.task?.execution?.workerTabId) {
        await closeConversationWorkerTab(all.task, all.task.execution.workerTabId, {
          reason: '任务循环结束，清理遗留沟通执行页'
        });
      }
    } catch (_) {}
    runner.running = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message || {};
  const clientVersion = String(message?.clientVersion || '');
  let { payload } = message || {};
  (async () => {
    if (VERSION_GUARDED_MESSAGES.has(type) && clientVersion !== BHT_RUNTIME_VERSION) {
      return {
        ok: false,
        error: 'EXTENSION_VERSION_MISMATCH',
        message: `扩展界面与后台版本不一致（界面 ${clientVersion || '未知'} / 后台 ${BHT_RUNTIME_VERSION}）。请在扩展管理页重新加载扩展，再刷新 BOSS 页面`,
        runtimeVersion: BHT_RUNTIME_VERSION,
        clientVersion
      };
    }
    switch (type) {
      case MSG.GET_BOSS_GREETING: {
        const guard = await assertBossContext(sender);
        if (!guard.ok) return guard;
        return await sendToBoss(MSG.GET_BOSS_GREETING, {}, { tabId: guard.tab.id });
      }
      case MSG.SET_BOSS_GREETING: {
        const guard = await assertBossContext(sender);
        if (!guard.ok) return guard;
        const result = await sendToBoss(MSG.SET_BOSS_GREETING, payload || {}, { tabId: guard.tab.id });
        await log(result?.ok ? 'success' : 'error', result?.ok
          ? ('BOSS 自动招呼已' + (result.enabled ? '开启' : '关闭') + '并完成回验')
          : (result?.message || '修改 BOSS 自动招呼失败'));
        if (result?.ok) {
          const all = await getAllConfig();
          if (all.task) {
            all.task.bossGreetingSnapshot = {
              ok: true,
              enabled: result.enabled === true,
              status: result.enabled ? 'on' : 'off',
              templateId: result.templateId || '',
              text: result.text || '',
              syncedAt: result.syncedAt || Date.now(),
              source: result.source || 'boss-api'
            };
            await publishTask(all.task);
          }
        }
        return result;
      }
      case MSG.SAVE_BOSS_GREETING_TEXT: {
        const guard = await assertBossContext(sender);
        if (!guard.ok) return guard;
        const result = await sendToBoss(MSG.SAVE_BOSS_GREETING_TEXT, payload || {}, { tabId: guard.tab.id });
        await log(result?.ok ? 'success' : 'error', result?.ok
          ? 'BOSS 自动招呼话术已保存并完成回验'
          : (result?.message || '保存 BOSS 自动招呼话术失败'));
        if (result?.ok) {
          const all = await getAllConfig();
          if (all.task) {
            all.task.bossGreetingSnapshot = {
              ok: true,
              enabled: result.enabled === true,
              status: result.enabled ? 'on' : 'off',
              templateId: result.templateId || '',
              text: result.text || '',
              syncedAt: result.syncedAt || Date.now(),
              source: result.source || 'boss-api'
            };
            await publishTask(all.task);
          }
        }
        return result;
      }
      case MSG.OPEN_BOSS_GREETING_SETTINGS: {
        const contextTab = await getActiveBossTab({ allowInactiveBossTab: true, sender });
        const tab = await chrome.tabs.create({
          url: 'https://www.zhipin.com/web/geek/notify-set?type=greetSet',
          active: true,
          ...(contextTab?.windowId != null ? { windowId: contextTab.windowId } : {})
        });
        return { ok: true, tabId: tab?.id || null, url: tab?.url || '' };
      }
      case MSG.GET_STATE: {
        const all = await getAllConfig();
        const tab = await getActiveBossTab({ sender });
        return {
          ok: true,
          ...all,
          activeTab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
          activeIsBoss: Boolean(tab),
          senderTab: sender?.tab ? { id: sender.tab.id, url: sender.tab.url || '' } : null,
          bossOnly: true,
          runtimeVersion: BHT_RUNTIME_VERSION,
          runner: runnerSnapshot()
        };
      }
      case MSG.GET_RUNNER_STATE:
        return {
          ok: true,
          runtimeVersion: BHT_RUNTIME_VERSION,
          now: Date.now(),
          runner: runnerSnapshot()
        };
      case MSG.SAVE_SETTINGS:
        await saveSettings(payload);
        await syncDebugLoggingSetting(payload);
        await debugLog('background.settings', 'saved', {
          debugLoggingEnabled,
          splitViewEnabled: payload?.splitViewEnabled !== false
        });
        return { ok: true };
      case MSG.SAVE_FILTERS:
        await saveFilters(payload);
        return { ok: true };
      case MSG.SAVE_TEMPLATE:
        await saveMessageTemplate(payload);
        return { ok: true };
      case MSG.SAVE_LISTS:
        await saveLists(payload);
        return { ok: true };
      case MSG.SAVE_RESUMES:
        await saveResumes(payload);
        return { ok: true };
      case MSG.SAVE_BINDINGS:
        await saveBindings(payload);
        return { ok: true };
      case MSG.RUN_PREVIEW: {
      return await withRunnerAdmission('previewing', async (previewRunId) => {
          const guard = await assertBossContext(sender);
          if (!guard.ok) {
            await log("warn", guard.message);
            return guard;
          }
          return await runPreview(payload || {}, guard.tab, previewRunId);
        });
      }
      case MSG.CONFIRM_AND_START: {
        return await withRunnerAdmission('starting', async () => {
        // CONFIRM_AND_START guard
        {
          const guard = await assertBossContext(sender);
          if (!guard.ok) {
            await log("warn", guard.message);
            return guard;
          }
        }
        const all = await getAllConfig();
        let task = all.task;
        if (!task) return { ok: false, error: 'NO_TASK' };
        if (!(task.results || []).length) {
          return { ok: false, error: 'NO_PREVIEW', message: '请先扫描预览，再批量投递' };
        }

        // 单份投完后 status 可能是 completed/stopped：允许直接进入批量
        const doneIds = collectDoneJobIds(task.items, task.queue, task.testedJobIds);

        let selectedIds = Array.isArray(payload?.selectedJobIds)
          ? payload.selectedJobIds.map(String).filter(Boolean)
          : [];
        // 去掉已投完的勾选
        selectedIds = selectedIds.filter((id) => !doneIds.has(id));
        if (!selectedIds.length) {
          // 自动勾选剩余未投通过岗（解决：投递一份后 results 只剩 1 个 selected）
          selectedIds = (task.results || [])
            .filter((r) => r?.decision === 'pass' && r?.job?.jobId && !doneIds.has(String(r.job.jobId)))
            .map((r) => String(r.job.jobId));
        }
        if (!selectedIds.length) {
          return {
            ok: false,
            error: 'NO_PENDING',
            message: '没有可批量投递的岗位。请重新扫描预览，或先用「投递一份」未投完的岗位'
          };
        }
        const setIds = new Set(selectedIds);
        task.results = (task.results || []).map((r) => ({
          ...r,
          selected: setIds.has(String(r.job?.jobId || ''))
        }));
        task.items = (task.items || []).map((it) => {
          const id = String(it.jobId || '');
          const selected = setIds.has(id);
          // 已完成的保留状态；待投的重置为可跑
          if (selected && !doneIds.has(id)) {
            return {
              ...it,
              selected: true,
              state: 'NOT_STARTED',
              reasons: [],
              lastError: '',
              completedAt: null
            };
          }
          return { ...it, selected };
        });
        // 补齐 items 里缺失的待投岗
        for (const id of selectedIds) {
          if ((task.items || []).some((it) => String(it.jobId) === id)) continue;
          const row = (task.results || []).find((r) => String(r.job?.jobId) === id);
          task.items = [
            ...(task.items || []),
            {
              jobId: id,
              company: row?.job?.company || '',
              title: row?.job?.title || '',
              state: 'NOT_STARTED',
              reasons: [],
              selected: true
            }
          ];
        }

        // 重建批量队列（保留已完成标记，供 loop 跳过）
        const rebuilt = buildDeliveryQueue(task.results || [], { selectedOnly: true });
        const prevQ = new Map((task.queue || []).map((q) => [String(q.jobId || ''), q]));
        task.queue = rebuilt.map((q, idx) => {
          const old = prevQ.get(String(q.jobId || ''));
          if (old && (old.status === 'done' || old.status === 'skipped' || old.status === 'failed')) {
            return { ...q, index: idx, status: old.status, outcome: old.outcome, finishedAt: old.finishedAt };
          }
          if (doneIds.has(String(q.jobId || ''))) {
            return { ...q, index: idx, status: 'done' };
          }
          return { ...q, index: idx, status: 'pending' };
        });
        task.queueCursor = Math.max(
          0,
          task.queue.findIndex((q) => q.status === 'pending')
        );
        if (task.queueCursor < 0) task.queueCursor = 0;

        // 退出单份测试模式
        task.testDelivery = false;
        task.testJobId = null;
        task.completionSignal = null;
        task.pauseReason = '';
        task.awaitingUserRetry = false;
        task.uiErrorDismissed = false;
        task.retryCurrent = false;
        task.consecutiveFails = 0;
        task.status = TASK_STATUS.RUNNING;
        const split = await prepareSplitWorkspace(task, all.settings || {});
        await publishTask(task);
        if (split.ok) {
          await log('success', '[分屏] 职位列表在左侧，消息中心在右侧', {
            listTabId: split.listTabId,
            messageTabId: split.messageTabId
          });
        } else if (!split.skipped) {
          await log('warn', '[分屏] ' + (split.message || '自动分屏不可用，已回退为普通标签页'));
        }
        await log('info', '批量投递启动：待投 ' + selectedIds.length + ' 岗（已跳过已完成 ' + doneIds.size + '）');
        // async loop
        runTaskLoop(task.id);
        return { ok: true, taskId: task.id, splitView: split, pending: selectedIds.length };
        });
      }
      case MSG.RUN_TEST_DELIVERY:
      case 'BHT_RUN_TEST_DELIVERY': {
        return await withRunnerAdmission('starting', async () => {
        {
          await log('info', '[投递一份] 收到启动请求', {
            senderTab: sender?.tab ? { id: sender.tab.id, url: sender.tab.url || '' } : null
          });
          const guard = await assertBossContext(sender);
          if (!guard.ok) {
            await log('warn', guard.message);
            return guard;
          }
          if (guard.tab?.id) {
            payload = {
              ...(payload || {}),
              listTabId: guard.tab.id,
              listWindowId: guard.tab.windowId
            };
          }
        }
        const all = await getAllConfig();
        let task = all.task;
        if (!task || !(task.results || []).length) {
          return { ok: false, error: 'NO_PREVIEW', message: '请先扫描预览，再使用「投递一份」' };
        }
        const wantId = payload?.jobId || (payload?.selectedJobIds && payload.selectedJobIds[0]) || null;
        // 单岗队列每次重建会丢掉旧 queue done，靠 testedJobIds / items 推进到下一岗
        const extraForPick = [...new Set((task.testedJobIds || []).map(String).filter(Boolean))];
        const picked = pickNextTestDeliveryJob({
          results: task.results || [],
          items: task.items || [],
          queue: task.queue || [],
          wantId,
          extraDoneIds: extraForPick
        });
        if (!picked.ok) {
          if (picked.error === 'ALL_TESTED') {
            await log('warn', '投递一份：通过岗位都已投过，请重新扫描预览或换一批岗位');
          }
          return picked;
        }
        const pick = picked.pick;
        const onlyId = pick.job.jobId;
        const remain = picked.remain;

        task.results = (task.results || []).map((r) => ({
          ...r,
          selected: r.job?.jobId === onlyId && r.decision === 'pass'
        }));

        // 只投这一岗：目标岗强制可跑；其它岗位取消 selected，已投状态保留
        {
          const hasItem = (task.items || []).some((it) => it.jobId === onlyId);
          if (hasItem) {
            task.items = (task.items || []).map((it) => {
              if (it.jobId !== onlyId) return { ...it, selected: false };
              return {
                ...it,
                selected: true,
                state: 'NOT_STARTED',
                reasons: [],
                lastError: '',
                completedAt: null
              };
            });
          } else {
            task.items = [
              ...(task.items || []).map((it) => ({ ...it, selected: false })),
              {
                jobId: onlyId,
                company: pick.job?.company || '',
                title: pick.job?.title || '',
                state: 'NOT_STARTED',
                reasons: [],
                selected: true
              }
            ];
          }

          task.queue = [
            {
              index: 0,
              jobId: pick.job.jobId,
              title: pick.job.title,
              company: pick.job.company,
              href: pick.job.href || '',
              securityId: pick.job.securityId || '',
              status: 'pending'
            }
          ];
          task.queueCursor = 0;
          task.currentJobId = onlyId;
          task.nextJobId = onlyId;
          task.consecutiveFails = 0;
          task.completionSignal = null;
        }

        if (payload?.listTabId) {
          task.execution = {
            ...(task.execution || {}),
            listTabId: payload.listTabId,
            listWindowId: payload.listWindowId || task.execution?.listWindowId || null
          };
        }
        task.testDelivery = true;
        task.testJobId = onlyId;
        task.testedJobIds = Array.from(new Set([...(task.testedJobIds || []).map(String), ...extraForPick]));
        task.status = TASK_STATUS.RUNNING;
        task.pauseReason = '';
        task.awaitingUserRetry = false;
        const split = await prepareSplitWorkspace(task, all.settings || {});
        await publishTask(task);
        if (split.ok) {
          await log('success', '[分屏] 投递一份已打开左右工作区', {
            listTabId: split.listTabId,
            messageTabId: split.messageTabId
          });
        } else if (!split.skipped) {
          await log('warn', '[分屏] ' + (split.message || '自动分屏不可用，已回退为普通标签页'));
        }
        await log(
          'info',
          '投递一份启动：本轮只投 1 岗「' +
            (pick.job?.title || '') +
            '」@ ' +
            (pick.job?.company || '') +
            '；剩余未投 ' +
            remain +
            ' 岗（活跃度不满足将自动顺延，投成功 1 岗后停止）',
          { jobId: onlyId, remain }
        );
        runTaskLoop(task.id);
        return {
          ok: true,
          testJobId: onlyId,
          job: pick.job,
          remain,
          splitView: split
        };
        });
      }

      case MSG.PAUSE_TASK:
        runner.pause = true;
        {
          const all = await getAllConfig();
          if (all.task) {
            all.task.status = TASK_STATUS.PAUSED;
            all.task.pauseReason = reasonText(REASON.EXEC_USER_PAUSE);
            await publishTask(all.task);
          }
        }
        await log('warn', '用户暂停任务');
        return { ok: true };
      case MSG.RESUME_TASK: {
        {
          const all0 = await getAllConfig();
          if (all0.task) {
            all0.task.awaitingUserRetry = false;
            // payload.retry === true 表示弹窗「重试」：只重置当前失败岗位
            const wantRetry = Boolean(payload?.retry);
            if (wantRetry) {
              let curId = all0.task.currentJobId;
              if (!curId) {
                curId = [...(all0.task.items || [])].reverse().find((it) => it.state === 'FAILED')?.jobId || null;
                if (curId) all0.task.currentJobId = curId;
              }
              let resetFailedItem = false;
              all0.task.items = (all0.task.items || []).map((it) => {
                if (curId && it.jobId === curId && it.state === 'FAILED') {
                  resetFailedItem = true;
                  const legacyChatFailure = !hasChatCheckpoint(it) &&
                    /多个相似会话|会话未可靠打开|会话已打开|CONVERSATION_|CHAT_EDITOR/i.test(
                      [...(it.reasons || []), all0.task.pauseReason || ''].join(' ')
                    );
                  return {
                    ...it,
                    state: 'NOT_STARTED',
                    reasons: [],
                    ...(legacyChatFailure ? {
                      phase: JOB_PHASE.CHAT_TRIGGERED,
                      triggeredAt: it.triggeredAt || Date.now(),
                      beforeConversationKeys: it.beforeConversationKeys || []
                    } : {})
                  };
                }
                return it;
              });
              if (resetFailedItem) {
                all0.task.counters = all0.task.counters || { success: 0, skipped: 0, failed: 0, processed: 0 };
                all0.task.counters.failed = Math.max(0, Number(all0.task.counters.failed || 0) - 1);
                const queueItem = (all0.task.queue || []).find((entry) => entry.jobId === curId);
                if (queueItem) {
                  queueItem.status = 'pending';
                  delete queueItem.finishedAt;
                  delete queueItem.outcome;
                }
                all0.task.testedJobIds = (all0.task.testedJobIds || []).filter((jobId) => String(jobId) !== String(curId));
                await debugLog('background.task', 'retry_item_reset', {
                  taskId: all0.task.id,
                  jobId: curId,
                  counters: all0.task.counters,
                  checkpointPhase: all0.task.items.find((it) => it.jobId === curId)?.phase || ''
                });
              }
              all0.task.retryCurrent = true;
              all0.task.uiErrorDismissed = false;
              all0.task.consecutiveFails = 0;
              all0.task.pauseReason = '';
              all0.task.lastErrorDetail = '';
              all0.task.errorKey = '';
            } else {
              // 工具栏「继续」：不自动重置失败项，跳过它们往下跑
              all0.task.retryCurrent = false;
              all0.task.uiErrorDismissed = true;
              all0.task.pauseReason = '';
              all0.task.lastErrorDetail = '';
              all0.task.errorKey = '';
            }
            await publishTask(all0.task);
          }
          runner.pauseLogged = false;
          runner.pausePublished = false;
        }
        {
          const guard = await assertBossContext(sender);
          if (!guard.ok) {
            await log("warn", guard.message);
            return guard;
          }
        }
        runner.pause = false;
        runner.abort = false;
        const all = await getAllConfig();
        if (!all.task) return { ok: false, error: 'NO_TASK' };
        all.task.status = TASK_STATUS.RUNNING;
        await publishTask(all.task);
        if (!runner.running) runTaskLoop(all.task.id);
        await log('info', payload?.retry ? '重试当前岗位' : '继续任务');
        return { ok: true };
      }
      case MSG.STOP_TASK:
        if (runner.previewing && !runner.running) {
          const cancelledPreviewRunId = runner.previewRunId;
          const previousPreviewTask = runner.previewPreviousTask;
          const previewRunPromise = activePreviewRun?.id === cancelledPreviewRunId
            ? activePreviewRun.promise
            : null;
          // 先使本轮 generation 失效，但在清理完成前保持门禁占用，
          // 防止新扫描读取到尚未回滚的预览任务快照。
          runner.previewRunId = '';
          runner.previewPhase = 'cancelling';
          await cancelActiveOperations('用户取消扫描预览');
          // Wait for the invalidated run to finish its publish/rollback and
          // close its worker before releasing admission to a new preview.
          if (previewRunPromise) {
            try { await previewRunPromise; } catch (_) {}
          }
          await discardCancelledPreviewTask(cancelledPreviewRunId, previousPreviewTask);
          runner.previewing = false;
          runner.previewStartedAt = 0;
          runner.previewScanStartedAt = 0;
          runner.previewScanFinishedAt = 0;
          runner.previewPhase = '';
          runner.previewScanned = 0;
          runner.previewPass = 0;
          runner.previewPreviousTask = null;
          const all = await getAllConfig();
          await log('warn', '用户已取消扫描预览');
          return { ok: true, previewCancelled: true, task: all.task || null };
        }
        runner.abort = true;
        runner.pause = false;
        await cancelActiveOperations('用户停止任务');
        {
          const all = await getAllConfig();
          if (all.task) {
            if (all.task.execution?.workerTabId) {
              await closeConversationWorkerTab(all.task, all.task.execution.workerTabId, {
                reason: '用户停止任务，关闭临时沟通执行页',
                publish: false
              });
            }
            all.task.status = TASK_STATUS.STOPPED;
            all.task.updatedAt = Date.now();
            setTaskTerminalSignal(all.task, TASK_STATUS.STOPPED);
            await publishTask(all.task);
            await log('warn', taskSummaryText(all.task, TASK_STATUS.STOPPED));
            return { ok: true, task: all.task };
          }
        }
        await log('warn', '用户停止任务：当前没有可汇报的任务');
        return { ok: true, task: null };
      case MSG.SKIP_CURRENT: {
        // 若在等待用户重试的暂停中：直接标记当前岗位跳过，并清掉 skip 标志，避免下一岗被连带跳过
        if (runner.pause) {
          const all = await getAllConfig();
          if (all.task) {
            all.task.awaitingUserRetry = false;
            if (all.task.currentJobId && all.task.items) {
              all.task.items = all.task.items.map((it) =>
                it.jobId === all.task.currentJobId && (it.state === 'FAILED' || it.state === 'NOT_STARTED' || it.state === 'COMMUNICATION_CREATED' || it.state === 'PAUSED')
                  ? { ...it, state: 'SKIPPED', reasons: ['用户跳过'] }
                  : it
              );
              const q = (all.task.queue || []).find((x) => x.jobId === all.task.currentJobId);
              if (q) {
                q.status = 'skipped';
                q.finishedAt = Date.now();
                q.outcome = 'skipped';
              }
              all.task.counters = all.task.counters || {};
              all.task.counters.skipped = (all.task.counters.skipped || 0) + 1;
            }
            await publishTask(all.task);
          }
          runner.skipCurrent = false;
          runner.pause = false;
          await bumpDailyStat('skip');
          await log('warn', '已跳过当前岗位，继续下一岗');
          return { ok: true };
        }
        runner.skipCurrent = true;
        await log('warn', '将跳过当前岗位');
        return { ok: true };
      }
      case MSG.DISMISS_ERROR_MODAL:
      case 'BHT_DISMISS_ERROR_MODAL': {
        // 用户关闭错误弹窗：保持暂停，不自动重试、不进入下一岗
        runner.pause = true;
        runner.abort = false;
        const all = await getAllConfig();
        if (all.task) {
          all.task.awaitingUserRetry = false;
          all.task.uiErrorDismissed = true;
          all.task.retryCurrent = false;
          all.task.status = TASK_STATUS.PAUSED;
          all.task.updatedAt = Date.now();
          await publishTask(all.task);
        }
        await log('warn', '用户关闭错误提示，任务保持暂停（不会自动重试）');
        return { ok: true };
      }
      case MSG.EXPORT_CONFIG:
        return { ok: true, data: await exportAll() };
      case MSG.IMPORT_CONFIG:
        await importAll(payload?.data || payload);
        return { ok: true };
      case MSG.GET_DEBUG_LOGS:
        {
          const config = await getAllConfig();
          const bossTabs = await chrome.tabs.query({ url: BOSS_MATCH_PATTERNS }).catch(() => []);
          return {
            ok: true,
            enabled: debugLoggingEnabled,
            meta: {
              version: chrome.runtime.getManifest().version,
              extensionId: chrome.runtime.id,
              exportedAt: new Date().toISOString(),
              sessionOnly: true,
              userAgent: globalThis.navigator?.userAgent || '',
              platform: globalThis.navigator?.platform || '',
              language: globalThis.navigator?.language || '',
              runner: sanitizeDebugValue({ ...runner, activeOperations: operations.size }),
              settings: sanitizeDebugValue({
                debugLoggingEnabled: config.settings?.debugLoggingEnabled === true,
                splitViewEnabled: config.settings?.splitViewEnabled !== false,
                messageMode: config.settings?.messageMode || '',
                consecutiveFailPause: config.settings?.consecutiveFailPause
              }),
              task: sanitizeDebugValue(config.task ? {
                id: config.task.id,
                status: config.task.status,
                revision: config.task.revision,
                counters: config.task.counters,
                currentJobId: config.task.currentJobId,
                nextJobId: config.task.nextJobId,
                pauseReason: config.task.pauseReason,
                lastErrorDetail: config.task.lastErrorDetail,
                awaitingUserRetry: config.task.awaitingUserRetry,
                queueCursor: config.task.queueCursor,
                queue: config.task.queue,
                items: config.task.items
              } : null),
              bossTabs: sanitizeDebugValue(bossTabs.map((tab) => ({
                id: tab.id,
                windowId: tab.windowId,
                active: tab.active,
                status: tab.status,
                title: tab.title,
                url: tab.url
              })))
            },
            logs: await getSessionDebugLogs()
          };
        }
      case MSG.SCAN_PROGRESS: {
        const count = Math.max(0, Number(payload?.count || 0));
        if (!runner.previewing || !count) return { ok: true, ignored: true };
        setPreviewPhase('collecting');
        setPreviewProgress(count, runner.previewPass || 0);
        return { ok: true };
      }
      case MSG.DEBUG_EVENT:
        if (!debugLoggingEnabled) return { ok: true, recorded: false };
        await appendSessionDebugLog({
          ts: Number(payload?.ts) || Date.now(),
          level: payload?.level || 'debug',
          scope: payload?.scope || 'content',
          event: payload?.event || 'event',
          taskId: payload?.taskId || null,
          data: sanitizeDebugValue(payload?.data || {})
        });
        return { ok: true, recorded: true };
      case MSG.CLEAR_LOGS:
        await clearLogs();
        return { ok: true };
      case MSG.CLEAR_HISTORY:
        await clearHistory();
        return { ok: true };
      case MSG.DIAGNOSE:
        return await sendToBoss(MSG.DIAGNOSE, payload || {});
      case MSG.PING:
        return { ok: true, from: 'background' };
      default:
        // content/log events ignored here
        if (type === MSG.LOG_EVENT || type === MSG.TASK_EVENT) return { ok: true };
        return { ok: false, error: 'UNKNOWN_TYPE', type };
    }
  })()
    .then(sendResponse)
    .catch(async (err) => {
      await debugLog('background.message', 'handler_exception', {
        type,
        sender: { tabId: sender?.tab?.id || null, url: sender?.url || sender?.tab?.url || '' },
        error: serializeError(err)
      }, 'error');
      sendResponse({ ok: false, error: String(err?.message || err), diagnostic: { error: serializeError(err) } });
    });
  return true;
});

// 供调试
globalThis.__BHT_BG__ = { runner, runPreview };
