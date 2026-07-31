import { MSG } from '../shared/messaging.js';
import {
  appendHistory,
  appendLog,
  bumpDailyStat,
  clearHistory,
  clearLogs,
  clearTask,
  exportAll,
  getAllConfig,
  getHistory,
  getIdempotencyMap,
  getLogs,
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
import { evaluateJob, summarizePreview } from '../shared/filter-engine.js';
import { checkDedup, checkLimits, jobIdempotencyKey, resumeIdempotencyKey } from '../shared/dedup.js';
import { planMessageSegments } from '../shared/message-planner.js';
import { pickResumeProfile } from '../shared/template.js';
import { REASON, reasonText } from '../shared/reason-codes.js';
import { TASK_STATUS } from '../shared/constants.js';
import { isBossUrl, isBossTab, bossUrlGuardMessage, BOSS_MATCH_PATTERNS } from '../shared/boss-url.js';
import { normalizeText, randomBetween, sleep, uid } from '../shared/text-utils.js';
import { computeSideBySideBounds } from '../shared/window-layout.js';

let runner = {
  running: false,
  abort: false,
  pause: false,
  skipCurrent: false,
  pauseLogged: false
};

chrome.runtime.onInstalled.addListener(async () => {
  await getAllConfig();
  try {
    // 一次性：若已上传图片但未开自动发，升级默认以符合「文本后发图」预期
    const all = await chrome.storage.local.get(['bht_settings', 'bht_resumes', 'bht_migrated_137']);
    if (!all.bht_migrated_137) {
      const settings = all.bht_settings || {};
      const resumes = all.bht_resumes || {};
      const hasImg = (resumes.profiles || []).some((p) => (p.images || []).length);
      let changed = false;
      if (hasImg && settings.autoSendImageResume === false) {
        settings.autoSendImageResume = true;
        changed = true;
      }
      if (hasImg && settings.resumeSendTiming === 'on_request') {
        settings.resumeSendTiming = 'after_text';
        changed = true;
      }
      if (changed) await chrome.storage.local.set({ bht_settings: settings });
      await chrome.storage.local.set({ bht_migrated_137: true });
    }
  } catch (_) {}
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

async function getActiveBossTab({ allowInactiveBossTab = false } = {}) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0];
  if (isBossTab(active)) return active;

  // 严格模式：当前激活页不是 BOSS 时，默认不跨标签操作
  if (!allowInactiveBossTab) return null;

  const all = await chrome.tabs.query({ url: BOSS_MATCH_PATTERNS });
  return all.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

async function forceInjectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["shared/conversation-match.js", "content/content-main.js"],
      injectImmediately: true
    });
    await sleep(120);
    return true;
  } catch (_) {
    return false;
  }
}



function jobHrefUsable(href) {
  const h = String(href || "");
  if (!h || h === "#" || /^javascript:/i.test(h)) return false;
  // 相对路径也可
  const abs = /zhipin\.com|bosszhipin\.com/i.test(h) || h.startsWith("/") || h.startsWith("http");
  if (!abs) return false;
  return /job_detail|encryptJobId|securityId=|jobId=|\/geek\/job|\/job\//i.test(h);
}

function normalizeBossJobHref(href) {
  const h = String(href || "").trim();
  if (!h) return "";
  try {
    if (h.startsWith("http")) return h;
    return new URL(h, "https://www.zhipin.com").href;
  } catch (_) {
    return h;
  }
}

function verifyQueueJob(expected, actual) {
  if (!expected || !actual) return { ok: false, reason: "EMPTY" };
  // 若实际还在列表页，不算打开成功
  if (actual.isListPage) return { ok: false, reason: "STILL_ON_LIST", actual };
  const eId = String(expected.jobId || "");
  const aId = String(actual.jobId || "");
  if (eId && aId && eId === aId) return { ok: true, via: "jobId" };
  const eSec = String(expected.securityId || "");
  const aSec = String(actual.securityId || "");
  if (eSec && aSec && eSec === aSec) return { ok: true, via: "securityId" };
  const et = normalizeText(expected.title || "");
  const at = normalizeText(actual.title || "");
  const ec = normalizeText(expected.company || "");
  const ac = normalizeText(actual.company || "");
  if (et && at && et === at && ec && ac && ec === ac) return { ok: true, via: "title+company" };
  // 有 jobId 却对不上：失败，不允许弱匹配
  if (eId && aId && eId !== aId) return { ok: false, reason: "JOBID_MISMATCH", expected: { jobId: eId, title: expected.title }, actual: { jobId: aId, title: actual.title } };
  if (et && at && et === at) return { ok: true, via: "title-only", weak: true };
  return {
    ok: false,
    reason: "IDENTITY_MISMATCH",
    expected: { title: expected.title, company: expected.company, jobId: eId, href: expected.href },
    actual: { title: actual.title, company: actual.company, jobId: aId, href: actual.href, isListPage: actual.isListPage }
  };
}

async function waitTabComplete(tabId, timeoutMs = 45000) {
  const start = Date.now();
  let lastUrl = "";
  let stableSince = 0;
  while (Date.now() - start < timeoutMs) {
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
    await sleep(200);
  }
  try { return await chrome.tabs.get(tabId); } catch (_) { return null; }
}

async function ensureWorkerTab(task) {
  if (!task.execution) task.execution = {};
  const oldId = task.execution.workerTabId;
  if (oldId) {
    try {
      const t = await chrome.tabs.get(oldId);
      if (t && isBossUrl(t.url || t.pendingUrl || "")) {
        await log("info", "复用投递工作页 tab=" + oldId + " url=" + String(t.url || "").slice(0, 160));
        return t;
      }
      await log("warn", "旧工作页不可用，将重建 tab=" + oldId + " url=" + String(t?.url || ""));
    } catch (_) {
      await log("warn", "旧工作页已关闭，将重建 tab=" + oldId);
    }
  }
  // 种子用 about:blank，避免先打开列表主页造成「在主页徘徊」的错觉
  const createOpts = { url: "about:blank", active: true };
  if (task.execution.listTabId) {
    try { createOpts.openerTabId = task.execution.listTabId; } catch (_) {}
  }
  const tab = await chrome.tabs.create(createOpts);
  task.execution.workerTabId = tab.id;
  task.execution.workerWindowId = tab.windowId;
  task.execution.phase = "WORKER_READY";
  await publishTask(task);
  await log("info", "新建投递工作页 tab=" + tab.id + "（将直接导航到岗位详情，不经列表主页）");
  return tab;
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
  task.execution.listWindowId = listTab.windowId;
  const display = await getDisplayMetrics(listTab.id);
  const bounds = computeSideBySideBounds(display || {}, { minWidth: 520, minHeight: 600 });
  if (!bounds) {
    task.execution.splitViewActive = false;
    return { ok: false, error: 'DISPLAY_TOO_SMALL', message: '当前屏幕空间不足，已回退为普通消息标签页' };
  }

  let originalWindow = null;
  try { originalWindow = await chrome.windows.get(listTab.windowId); } catch (_) {}
  try {
    await setNormalWindowBounds(listTab.windowId, bounds.left);

    let messageTab = null;
    if (task.execution.messageTabId) {
      messageTab = await chrome.tabs.get(task.execution.messageTabId).catch(() => null);
    }
    if (!messageTab?.id) {
      const bossTabs = await chrome.tabs.query({ url: BOSS_MATCH_PATTERNS });
      messageTab = bossTabs.find((tab) => tab.id !== listTab.id && /\/chat/i.test(tab.url || tab.pendingUrl || '')) || null;
    }

    let messageWindow;
    const existingWindowTabs = messageTab?.windowId != null
      ? await chrome.tabs.query({ windowId: messageTab.windowId })
      : [];
    if (messageTab?.id && (messageTab.windowId === listTab.windowId || existingWindowTabs.length > 1)) {
      messageWindow = await chrome.windows.create({
        tabId: messageTab.id,
        type: 'normal',
        focused: false,
        ...bounds.right
      });
      messageTab = messageWindow.tabs?.[0] || await chrome.tabs.get(messageTab.id);
    } else if (messageTab?.id) {
      await setNormalWindowBounds(messageTab.windowId, bounds.right);
      messageWindow = await chrome.windows.get(messageTab.windowId, { populate: true });
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
    await setNormalWindowBounds(messageWindow.id, bounds.right);
    if (!/\/chat/i.test(messageTab.url || messageTab.pendingUrl || '')) {
      messageTab = await chrome.tabs.update(messageTab.id, {
        url: 'https://www.zhipin.com/web/geek/chat',
        active: true
      });
    }
    await waitTabComplete(messageTab.id, 25000);
    await forceInjectContent(messageTab.id);

    task.execution.splitViewActive = true;
    task.execution.splitBounds = bounds;
    task.execution.phase = 'SPLIT_WORKSPACE_READY';

    await chrome.tabs.update(listTab.id, { active: true }).catch(() => {});
    await chrome.windows.update(listTab.windowId, { focused: true }).catch(() => {});
    return { ok: true, listTabId: listTab.id, messageTabId: messageTab.id, bounds };
  } catch (error) {
    task.execution.splitViewActive = false;
    task.execution.splitViewError = String(error?.message || error);
    if (originalWindow?.width && originalWindow?.height) {
      await setNormalWindowBounds(listTab.windowId, {
        left: originalWindow.left || 0,
        top: originalWindow.top || 0,
        width: originalWindow.width,
        height: originalWindow.height
      }).catch(() => {});
    }
    await chrome.tabs.update(listTab.id, { active: true }).catch(() => {});
    await chrome.windows.update(listTab.windowId, { focused: true }).catch(() => {});
    return {
      ok: false,
      error: 'SPLIT_VIEW_FAILED',
      message: '浏览器未允许自动分屏，已回退为普通消息标签页：' + task.execution.splitViewError
    };
  }
}


async function ensureMessageTab(task) {
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
  await forceInjectContent(tab.id);
  await sleep(400);
  await log("info", "[消息页] 已创建 tab=" + tab.id);
  return tab;
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

async function openQueueJobOnWorker(task, job) {
  const worker = await ensureWorkerTab(task);
  const tabId = worker.id;
  let href = normalizeBossJobHref(job.href || "");
  if (!jobHrefUsable(href) && job.jobId && !String(job.jobId).startsWith("name_") && !String(job.jobId).startsWith("dom_")) {
    // 尝试用 jobId 拼详情 URL
    href = "https://www.zhipin.com/job_detail/" + job.jobId + ".html";
    await log("info", "队列项原 href 不可用，尝试用 jobId 拼接详情 URL", {
      jobId: job.jobId,
      rawHref: String(job.href || "").slice(0, 160),
      built: href
    });
  }
  if (!jobHrefUsable(href)) {
    await log("error", "队列项无可用岗位链接，无法直达", {
      jobId: job.jobId,
      title: job.title,
      rawHref: String(job.href || ""),
      company: job.company
    });
    return { ok: false, error: "NO_HREF", message: "队列项缺少可用岗位链接（href 为空或不是详情页）。请重新扫描预览", tabId };
  }

  task.execution.phase = "NAVIGATING_JOB";
  task.currentJobId = job.jobId;
  await publishTask(task);

  let beforeUrl = "";
  try { beforeUrl = (await chrome.tabs.get(tabId)).url || ""; } catch (_) {}
  await log("info", "工作页导航→岗位详情", {
    tabId,
    beforeUrl: String(beforeUrl).slice(0, 160),
    targetHref: String(href).slice(0, 200),
    jobId: job.jobId,
    title: job.title,
    company: job.company
  });

  try {
    await chrome.tabs.update(tabId, { url: href, active: true });
  } catch (e) {
    await log("error", "工作页 tabs.update 失败：" + String(e?.message || e), { tabId, href });
    return { ok: false, error: "NAV_FAIL", message: String(e?.message || e), tabId };
  }

  const ready = await waitTabComplete(tabId, 45000);
  let afterUrl = "";
  try { afterUrl = ready?.url || (await chrome.tabs.get(tabId)).url || ""; } catch (_) {}
  await log("info", "工作页导航完成", {
    tabId,
    afterUrl: String(afterUrl).slice(0, 200),
    stillList: /\/web\/geek\/jobs/i.test(afterUrl),
    isJobLike: /job_detail|encryptJobId|\/geek\/job/i.test(afterUrl)
  });

  if (!ready) {
    return { ok: false, error: "TAB_LOAD_TIMEOUT", message: "岗位页加载超时 url=" + afterUrl, tabId };
  }
  if (/\/web\/geek\/jobs\/?($|\?)/i.test(afterUrl) && !/job_detail|encryptJobId/i.test(afterUrl)) {
    await log("error", "导航后仍停在职位列表/主页，未进入详情。目标 href 可能无效", {
      targetHref: href.slice(0, 200),
      afterUrl: afterUrl.slice(0, 200)
    });
    return {
      ok: false,
      error: "STILL_ON_LIST",
      message: "工作页仍在列表主页，未打开岗位详情。href=" + href.slice(0, 120),
      tabId,
      afterUrl
    };
  }

  await forceInjectContent(tabId);
  await sleep(600);

  let detail = await sendToBoss(MSG.GET_CURRENT_JOB_DETAIL || "BHT_GET_CURRENT_JOB_DETAIL", {}, { tabId, forceInject: true });
  await log("info", "工作页岗位详情解析", {
    ok: Boolean(detail?.ok),
    title: detail?.job?.title || "",
    company: detail?.job?.company || "",
    jobId: detail?.job?.jobId || "",
    href: String(detail?.job?.href || afterUrl).slice(0, 160),
    isListPage: detail?.job?.isListPage,
    isJobPage: detail?.job?.isJobPage
  });

  if (!detail?.ok || !detail.job) {
    return {
      ok: false,
      error: "DETAIL_PARSE_FAIL",
      message: "已打开页面但无法解析岗位详情，不继续发送。url=" + String(afterUrl).slice(0, 160),
      tabId,
      afterUrl
    };
  }

  const v = verifyQueueJob(job, detail.job);
  if (!v.ok) {
    await log("error", "岗位身份校验失败：" + (v.reason || "") , { verify: v, expectedTitle: job.title, actualTitle: detail.job.title });
    return {
      ok: false,
      error: v.reason || "IDENTITY_MISMATCH",
      message: "打开的岗位与队列不一致（" + (v.reason || "") + "），已跳过避免投错",
      verify: v,
      tabId,
      detail: detail.job
    };
  }

  await log("success", "工作页岗位就绪 · 校验通过(" + (v.via || "") + (v.weak ? ",weak" : "") + ")", {
    tabId,
    via: v.via,
    url: String(detail.job.href || afterUrl).slice(0, 160),
    title: detail.job.title,
    company: detail.job.company
  });
  return { ok: true, tabId, detail: detail.job, matchedVia: v.via || "href-nav", afterUrl };
}

async function sendToBoss(type, payload = {}, { retries = 2, forceInject = false, tabId = null } = {}) {
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
    MSG.START_CHAT,
    MSG.SEND_TEXT,
    MSG.SEND_IMAGE,
    MSG.SEND_RESUME,
    MSG.SCAN_JOBS,
    MSG.RETURN_TO_LIST,
    MSG.CLOSE_CHAT,
    MSG.ENSURE_JOB_LIST
  ];
  const longOps = [MSG.START_CHAT, MSG.SEND_TEXT, MSG.SEND_IMAGE, MSG.SEND_RESUME, MSG.SCAN_JOBS, MSG.RETURN_TO_LIST];

  let needInject = forceInject;
  if (!needInject && critical.includes(type)) {
    try {
      const pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} });
      if (!pong?.ok) needInject = true;
    } catch (_) {
      needInject = true;
    }
  }
  if (needInject) {
    await forceInjectContent(tab.id);
    await sleep(180);
  }

  // 长操作优先 storage 桥（立即 ACK + 轮询结果），避免 SPA 销毁 channel
  if (longOps.includes(type)) {
    try {
      const opId = 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      await chrome.storage.local.remove('bht_op_' + opId).catch(() => {});
      await chrome.storage.local.set({ ['bht_op_' + opId]: { status: 'pending', opType: type, at: Date.now() } });
      const fireOp = async () => {
        const ack = await chrome.tabs.sendMessage(tab.id, {
          type: 'BHT_RUN_OP',
          payload: { opId, opType: type, opPayload: payload }
        });
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
        await forceInjectContent(tab.id);
        await sleep(220);
        fired = await fireOp();
      }
      if (!fired) throw new Error('RUN_OP_NOT_SUPPORTED');
      const started = Date.now();
      let reinjectAt = started + 8000;
      while (Date.now() - started < 90000) {
        await sleep(350);
        const bag = await chrome.storage.local.get('bht_op_' + opId);
        const row = bag && bag['bht_op_' + opId];
        if (row && row.status === 'done') {
          const result = row.result || { ok: false, error: 'EMPTY_OP_RESULT' };
          if (result && result.error === 'OP_BUSY') {
            try {
              await chrome.storage.local.set({
                ['bht_op_' + opId]: { status: 'pending', opType: type, at: Date.now(), note: 'ignore-op-busy' }
              });
            } catch (_) {}
            continue;
          }
          try { await chrome.storage.local.remove('bht_op_' + opId); } catch (_) {}
          // 页面跳转中断：对发消息/开聊自动重试一次
          if (result && result.error === 'NAVIGATED' && (type === MSG.SEND_TEXT || type === MSG.START_CHAT) && !payload.__navRetried) {
            await forceInjectContent(tab.id);
            await sleep(350);
            return await sendToBoss(type, { ...payload, __navRetried: true }, { retries, forceInject: true, tabId: tab.id });
          }
          return result;
        }
        // START_CHAT：若已进入聊天页且输入框可用，直接视为成功（SPA 跳转会杀死原 content）
        if (type === MSG.START_CHAT && Date.now() - started > 2500) {
          try {
            let pong = null;
            try {
              pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} });
            } catch (_) { pong = null; }
            if (!pong?.ok) {
              await forceInjectContent(tab.id);
              await sleep(260);
              try { pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} }); } catch (_) {}
            }
            const page = pong?.page || {};
            if (page.hasChatInput || (page.isChatPage && page.hasChatInput !== false && pong?.ok)) {
              // 二次确认：请求一次 PAGE_INFO
              let info = page;
              try {
                const pi = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_PAGE_INFO, payload: {} });
                if (pi?.page) info = pi.page;
              } catch (_) {}
              if (info.hasChatInput) {
                try { await chrome.storage.local.remove('bht_op_' + opId); } catch (_) {}
                return {
                  ok: true,
                  already: true,
                  job: (payload && payload.job) || {},
                  matchedVia: 'bg-probe-chat',
                  contentVersion: pong?.contentVersion
                };
              }
            }
          } catch (_) {}
        }
        // 超时前若仍 pending：content 被导航销毁时重注入并重发
        if (Date.now() > reinjectAt && longOps.includes(type)) {
          reinjectAt = Date.now() + 12000;
          try {
            const latest = await chrome.tabs.get(tab.id);
            if (!isBossUrl(latest?.url || '')) continue;

            let alive = false;
            let pong = null;
            try {
              pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} });
              alive = Boolean(pong?.ok);
            } catch (_) { alive = false; }

            // START_CHAT：只探测聊天是否已就绪，绝不对同一 opId 再 fireOp（防 OP_BUSY 覆盖）
            if (type === MSG.START_CHAT) {
              if (!alive) {
                await forceInjectContent(tab.id);
                await sleep(300);
                try {
                  pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING, payload: {} });
                  alive = Boolean(pong?.ok);
                } catch (_) { alive = false; }
              }
              if (alive && pong?.page?.hasChatInput) {
                try { await chrome.storage.local.remove('bht_op_' + opId); } catch (_) {}
                return {
                  ok: true,
                  already: true,
                  job: (payload && payload.job) || {},
                  matchedVia: 'bg-probe-chat-wait',
                  contentVersion: pong?.contentVersion
                };
              }
              // content 仍活着且在跑：继续等，不重复 START_CHAT
              continue;
            }

            // 其它长操作：仅当 content 已死时重注入并重发一次（content 侧 opId 幂等）
            if (!alive) {
              await forceInjectContent(tab.id);
              await sleep(280);
              await fireOp();
            }
          } catch (_) {}
        }
      }
      return { ok: false, error: 'OP_TIMEOUT', message: '操作超时（岗位定位/发消息）。请保持在职位列表页并重新扫描预览' };
    } catch (bridgeErr) {
      // fall through to port/message
      console.warn('storage bridge fail', bridgeErr);
    }
  }

  // 次选 Port
  if (longOps.includes(type)) {
    try {
      const result = await new Promise((resolve, reject) => {
        let done = false;
        const reqId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
        let port;
        try {
          port = chrome.tabs.connect(tab.id, { name: 'bht-op' });
        } catch (e) {
          reject(e);
          return;
        }
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          try { port.disconnect(); } catch (_) {}
          reject(new Error('PORT_TIMEOUT'));
        }, 120000);
        port.onMessage.addListener((msg) => {
          if (!msg || msg.reqId !== reqId) return;
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { port.disconnect(); } catch (_) {}
          resolve(msg.result);
        });
        port.onDisconnect.addListener(() => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const err = chrome.runtime.lastError?.message || 'PORT_DISCONNECTED';
          reject(new Error(err));
        });
        try {
          port.postMessage({ type, payload, reqId });
        } catch (e) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(e);
        }
      });
      if (result) return result;
    } catch (errPort) {
      const msgP = String(errPort?.message || errPort || '');
      // START_CHAT_RECOVER: 点击导致脚本上下文销毁时，等页面稳定后重试
      if (type === MSG.START_CHAT && /PORT_DISCONNECTED|Receiving end does not exist|message channel closed/i.test(msgP)) {
        await sleep(1200);
        try {
          const latest = await chrome.tabs.get(tab.id);
          if (isBossUrl(latest?.url || '')) {
            await forceInjectContent(tab.id);
            await sleep(350);
            if (retries > 0) {
              return sendToBoss(type, payload, { retries: retries - 1, forceInject: true, tabId: tab.id });
            }
          }
        } catch (_) {}
      }
      if (retries > 0) {
        await forceInjectContent(tab.id);
        await sleep(400);
        return sendToBoss(type, payload, { retries: retries - 1, forceInject: true, tabId: tab.id });
      }
      // fall through to sendMessage once
      try {
        return await chrome.tabs.sendMessage(tab.id, { type, payload });
      } catch (e2) {
        return {
          ok: false,
          error: 'CONTENT_PORT_FAIL',
          message: msgP + ' | ' + String(e2?.message || e2)
        };
      }
    }
  }

  try {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type, payload });
    } catch (err0) {
      const msg0 = String(err0?.message || err0 || "");
      if (retries > 0 && /message channel closed|Receiving end does not exist|asynchronous response|Could not establish|PORT_/i.test(msg0)) {
        await forceInjectContent(tab.id);
        await sleep(450);
        return sendToBoss(type, payload, { retries: retries - 1, forceInject: true, tabId: tab.id });
      }
      await forceInjectContent(tab.id);
      await sleep(200);
      return await chrome.tabs.sendMessage(tab.id, { type, payload });
    }
  } catch (err) {
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
      return {
        ok: false,
        error: "CONTENT_INJECT_FAIL",
        message: String(e2?.message || err?.message || e2)
      };
    }
  }
}

async function assertBossContext() {
  const tab = await getActiveBossTab({ allowInactiveBossTab: false });
  if (!tab) {
    const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return {
      ok: false,
      error: "NO_BOSS_TAB",
      message: bossUrlGuardMessage(active?.url || ""),
      activeTab: active ? { id: active.id, url: active.url, title: active.title } : null
    };
  }
  return { ok: true, tab };
}

async function log(level, message, extra = {}) {
  const entry = await appendLog({ level, message, ...extra });
  try {
    chrome.runtime.sendMessage({ type: MSG.LOG_EVENT, payload: entry }).catch(() => {});
  } catch (_) {}
  return entry;
}

async function publishTask(task) {
  await saveTask(task);
  try {
    chrome.runtime.sendMessage({ type: MSG.TASK_EVENT, payload: task }).catch(() => {});
  } catch (_) {}
}

function taskCounterSnapshot(task) {
  const counters = task?.counters || {};
  return {
    success: Number(counters.success || 0),
    skipped: Number(counters.skipped || 0),
    failed: Number(counters.failed || 0),
    processed: Number(counters.processed || 0)
  };
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


function buildDeliveryQueue(results = [], { selectedOnly = true } = {}) {
  const rows = (results || []).filter((r) => r.decision === 'pass' && (selectedOnly ? r.selected !== false : true));
  const seen = new Set();
  const queue = [];
  for (const r of rows) {
    const job = r.job || {};
    const id = String(job.jobId || '');
    const title = normalizeText(job.title || '');
    const company = normalizeText(job.company || '');
    const key = id && !id.startsWith('name_') && !id.startsWith('dom_')
      ? 'id:' + id
      : 'tc:' + company + '|' + title;
    if (seen.has(key)) continue;
    if (!title && !id) continue;
    seen.add(key);
    queue.push({
      index: queue.length,
      jobId: job.jobId,
      title: job.title,
      company: job.company,
      href: job.href || '',
      securityId: job.securityId || '',
      status: 'pending'
    });
  }
  return queue;
}

async function runPreview(payload = {}) {
  await log('info', '开始扫描预览…');
  const config = await getAllConfig();
  const previewTab = await getActiveBossTab({ allowInactiveBossTab: false });
  const scan = await sendToBoss(MSG.SCAN_JOBS, { scroll: payload.scroll !== false, maxRounds: payload.maxRounds || 6 });
  if (!scan?.ok) {
    await log('error', scan?.message || '扫描失败', { error: scan?.error });
    return { ok: false, ...scan };
  }
  const previewListHref = scan.listHref || '';

  const history = config.history || [];
  const todayStats = await getTodayStats();
  const idempotency = config.idempotency || {};
  const results = [];

  for (const job of scan.jobs || []) {
    const filterRes = evaluateJob(job, config.filters, config.lists, config.settings);
    let decision = filterRes.decision;
    let reasonCodes = filterRes.reasonCodes || [];
    let reasonTexts = filterRes.reasonTexts || [];
    let passReasons = filterRes.passReasons || [];

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
      }
    }

    results.push({
      job,
      decision,
      reasonCodes,
      reasonTexts,
      passReasons,
      selected: decision === 'pass'
    });
  }

  const summary = summarizePreview(results);
  const passRate = summary.scanned ? summary.pass / summary.scanned : 0;
  const warnings = [];
  if (summary.scanned >= 10 && passRate > 0.8) warnings.push('通过率超过 80%，请检查筛选是否过宽');
  if (summary.scanned >= 10 && passRate < 0.05) warnings.push('通过率低于 5%，请检查筛选是否过严');

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
    counters: { processed: 0, success: 0, skipped: 0, failed: 0 },
    currentJobId: null,
    consecutiveFails: 0,
    execution: {
      listTabId: previewTab?.id || null,
      listWindowId: previewTab?.windowId || null
    }
  };

  
  task.listHref = previewListHref || task.listHref || '';
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
  await log('info', '预览队列已建立：' + task.queue.length + ' 个待投；列表锚点 ' + String(task.listHref || '无').slice(0, 140));
await publishTask(task);

  // highlight
  const map = {};
  for (const r of results) map[r.job.jobId] = { decision: r.decision };
  await sendToBoss(MSG.HIGHLIGHT_JOBS, { map });

  await log('success', `预览完成：扫描 ${summary.scanned}，通过 ${summary.pass}，排除 ${summary.reject}`);
  return { ok: true, task, summary, warnings };
}

function itemErrorHint(task, row) {
  const item = (task.items || []).find((x) => x.jobId === row?.job?.jobId);
  const reason = (item?.reasons || []).filter(Boolean).join('；');
  return reason || task.pauseReason || '';
}

async function waitWhilePaused(task) {
  // 不在此处重复 publish，避免弹窗被 TASK_EVENT 反复触发
  while (runner.pause && !runner.abort) {
    await sleep(350);
  }
}

async function processOneJob(task, resultRow, config) {
  const job = { ...resultRow.job };
  if (!job.listHref && task.listHref) job.listHref = task.listHref;
  resultRow.job = job;
  const item = ensureItem(task, job);
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

  // re-check dedup
  const history = await getHistory();
  const idempotency = await getIdempotencyMap();
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

  await log('info', `开始沟通：${job.title} @ ${job.company || ''}`, {
    jobId: job.jobId,
    href: String(job.href || '').slice(0, 180),
    securityId: job.securityId || '',
    listHref: String(job.listHref || task.listHref || '').slice(0, 120),
    workerTabId: task.execution?.workerTabId || null
  });
  // version stamp for support
  // (content reports its version in START_CHAT response)



// 列表恢复交给 START_CHAT 原子处理，避免预先 CLOSE/ENSURE 打乱虚拟列表
    // 工作页直达岗位 href（列表页不动；正常路径不再 RETURN_TO_LIST 找下一岗）
  if (task.listHref && !job.listHref) job.listHref = task.listHref;
  let workerTabId = task.execution?.workerTabId || null;
  await log('info', `[任务] 开始处理：${job.title} @ ${job.company || ''}`, {
    jobId: job.jobId,
    href: String(job.href || '').slice(0, 160),
    securityId: job.securityId || '',
    listHref: String(job.listHref || task.listHref || '').slice(0, 140)
  });

  // ===== v1.5 主路径：列表页建会话 + 消息页发送 =====
  const listTab = await ensureListTab(task);
  const listTabId = listTab?.id || task.execution?.listTabId || null;
  if (!listTabId) {
    item.state = 'FAILED';
    item.reasons = ['未绑定列表页，请在职位列表页重新扫描预览'];
    task.counters.failed += 1;
    await log('error', '[列表页] 未找到列表标签页', { jobId: job.jobId });
    return 'failed';
  }
  const listOpt = { tabId: listTabId, forceInject: true };

  let messageTab;
  try {
    messageTab = await ensureMessageTab(task);
  } catch (e) {
    item.state = 'FAILED';
    item.reasons = ['无法打开消息页：' + String(e?.message || e)];
    task.counters.failed += 1;
    await log('error', '[消息页] 创建失败：' + String(e?.message || e), { jobId: job.jobId });
    return 'failed';
  }
  const msgTabId = messageTab.id;
  const msgOpt = { tabId: msgTabId, forceInject: true };

  // 消息页快照（点击沟通前）
  let beforeSnap = await sendToBoss(MSG.GET_CONVERSATION_SNAPSHOT || 'BHT_GET_CONVERSATION_SNAPSHOT', {}, msgOpt);
  await log('info', '[消息页] 沟通前会话快照 count=' + (beforeSnap?.count || 0), {
    href: beforeSnap?.href,
    sample: (beforeSnap?.items || []).slice(0, 3).map((x) => x.text)
  });

  // 列表页：定位 + 立即沟通 + 留在此页
  await log('info', '[列表页] 定位并触发沟通', { jobId: job.jobId, title: job.title, tabId: listTabId });
  const trig = await sendToBoss(
    MSG.TRIGGER_CONVERSATION || 'BHT_TRIGGER_CONVERSATION',
    { job },
    listOpt
  );
  await log(
    trig?.ok ? 'success' : 'error',
    trig?.ok
      ? ('[列表页] 已触发沟通 btn=' + (trig.buttonText || '') + (trig.stayed ? ' · 已点留在此页' : ' · 未检测到留在此页弹窗') + (trig.already ? ' · 继续沟通' : ''))
      : ('[列表页] 触发沟通失败：' + (trig?.message || trig?.error || '')),
    { jobId: job.jobId, detailTitle: trig?.detailTitle, samples: trig?.samples }
  );
  if (!trig?.ok) {
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

  // 消息页阶段一：解析并打开会话（不含输入框门禁）
  await sleep(600);
  try { await chrome.tabs.update(msgTabId, { active: true }); } catch (_) {}
  await sleep(400);
  await log('info', '[消息页] 等待并匹配会话…', { jobId: job.jobId, company: job.company, title: job.title });
  let conv = await sendToBoss(
    MSG.WAIT_OPEN_CONVERSATION || 'BHT_WAIT_OPEN_CONVERSATION',
    { job, beforeKeys: beforeSnap?.keys || [], timeoutMs: 18000 },
    msgOpt
  );
  if (!conv?.ok && conv?.error === 'CONVERSATION_NOT_FOUND') {
    await sleep(1000);
    await forceInjectContent(msgTabId);
    try { await chrome.tabs.update(msgTabId, { active: true }); } catch (_) {}
    conv = await sendToBoss(
      MSG.WAIT_OPEN_CONVERSATION || 'BHT_WAIT_OPEN_CONVERSATION',
      { job, beforeKeys: beforeSnap?.keys || [], timeoutMs: 12000 },
      msgOpt
    );
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

  // 消息页阶段二：等待输入框（失败=暂停，绝不当成未找到会话）
  await log('info', '[消息页] 等待聊天输入框…', { jobId: job.jobId });
  try { await chrome.tabs.update(msgTabId, { active: true }); } catch (_) {}
  let editor = await sendToBoss(
    MSG.WAIT_CHAT_EDITOR || 'BHT_WAIT_CHAT_EDITOR',
    { timeoutMs: 30000 },
    msgOpt
  );
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
    item.phase = 'CONVERSATION_OPENED_EDITOR_PENDING';
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
    await sendToBoss(MSG.RETURN_TO_LIST, {});
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
  await bumpDailyStat('communicate', 1, normalizeText(job.company || ''));
  await log('success', '已进入沟通，开始发送消息', {
    jobId: job.jobId,
    matchedVia: chatRes?.matchedVia,
    conversation: conv?.conversationText || conv?.active?.text || '',
    head: conv?.active?.head || ''
  });

  // messages
  const selfRes = await sendToBoss(MSG.GET_CHAT_SELF_MESSAGES, { limit: 8 }, tabOpt);
  const recentSelfMessages = selfRes?.messages || [];
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
    idempotency
  });

  if (plan.nativeDetected) {
    item.state = 'NATIVE_GREETING_DETECTED';
    await log('info', '检测到原生/已发打招呼，跳过第一段', { jobId: job.jobId });
  }
  if (!plan.plan?.length) {
    await log('warn', '没有待发送的消息段（可能都被跳过或模板为空），将继续尝试简历发送', { jobId: job.jobId });
  } else {
    await log('info', '准备发送 ' + plan.plan.length + ' 段消息', { jobId: job.jobId });
  }

  for (const step of plan.plan) {
    await waitWhilePaused(task);
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
      await sendToBoss(MSG.RETURN_TO_LIST, {});
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

  // resume
  const profile = pickResumeProfile(job, config.resumes, config.bindings);
  const timing = config.settings.resumeSendTiming || 'on_request';
  const hasImages = Boolean(profile?.images?.length);
  const flagImage = Boolean(config.settings.autoSendImageResume);
  // 兼容旧设置字段：现在表示点击 BOSS 聊天页「发简历」，不再上传本地附件。
  const flagPlatformResume = Boolean(config.settings.autoSendAttachmentResume);
  const wantAutoImage = Boolean(flagImage && hasImages);
  const wantPlatformResume = flagPlatformResume;
  // 仅 after_text 自动发；其余情况写清原因，避免「发了文字没发简历」困惑
  const doResume = Boolean((wantAutoImage || wantPlatformResume) && timing === 'after_text');
  if (!doResume) {
    let why = '';
    if (timing !== 'after_text') why = '发送时机不是「文本发送完成后立即发送」';
    else if (!flagImage && !flagPlatformResume) why = '未启用图片简历或 BOSS 在线简历';
    else if (flagImage && !hasImages && !flagPlatformResume) why = '已启用图片简历，但当前方案中无图片';
    else why = '当前配置不满足自动发简历条件';
    await log('info', '本次不自动发送简历：' + why, {
      jobId: job.jobId,
      timing,
      flagImage,
      flagPlatformResume,
      hasImages,
      profileId: profile?.id || null
    });
  } else {
    await log('info', '将自动发送简历：' + [
      wantAutoImage ? ('图片' + (profile.images?.length || 0) + '张') : '',
      wantPlatformResume ? 'BOSS 在线简历' : ''
    ].filter(Boolean).join(' + '), { jobId: job.jobId, profileId: profile?.id || null });
  }

  if (doResume) {
    if (wantAutoImage) {
      for (let i = 0; i < profile.images.length; i++) {
        const img = profile.images[i];
        const key = resumeIdempotencyKey(job, `image_${i}`, profile.id);
        if (await hasIdempotent(key)) continue;
        const imgRes = await sendToBoss(MSG.SEND_IMAGE, {
          dataUrl: img.dataUrl,
          fileName: img.name || `resume_${i + 1}.png`
        }, tabOpt);
        if (!imgRes?.ok) {
          await log('warn', `图片简历发送失败：${imgRes?.message || imgRes?.error || ''}`, { jobId: job.jobId });
          break;
        }
        await markIdempotent(key, { jobId: job.jobId });
        item.state = 'IMAGE_RESUME_SENT';
        await log('success', `图片简历已发送 ${i + 1}/${profile.images.length}`, { jobId: job.jobId });
        await sleep(randomBetween(config.settings.segmentIntervalMs));
      }
    }
    if (wantPlatformResume) {
      const key = resumeIdempotencyKey(job, 'boss_online', profile?.id || 'boss_online');
      if (!(await hasIdempotent(key))) {
        const resumeRes = await sendToBoss(MSG.SEND_RESUME, {
          jobId: job.jobId,
          conversationKey: conv?.active?.key || ''
        }, tabOpt);
        const resumeConfirmed =
          resumeRes?.ok === true &&
          resumeRes?.confirmed === true &&
          resumeRes?.receipt?.type === 'RESUME_SENT' &&
          resumeRes?.receipt?.status === 'confirmed';
        if (resumeConfirmed) {
          await markIdempotent(key, { jobId: job.jobId });
          item.state = 'PLATFORM_RESUME_SENT';
          item.resumeReceipt = resumeRes.receipt;
          task.lastReceipt = resumeRes.receipt;
          task.updatedAt = Date.now();
          await publishTask(task);
          await log('success', resumeRes?.already ? 'BOSS 在线简历此前已发送' : 'BOSS 在线简历发送确认', {
            jobId: job.jobId,
            receiptId: resumeRes.receipt.receiptId,
            confirmedVia: resumeRes.receipt.confirmedVia
          });
        } else {
          item.state = 'FAILED';
          item.reasons = [reasonText(REASON.EXEC_SEND_FILE_FAIL, resumeRes?.message || resumeRes?.error || '')];
          task.pauseReason = item.reasons[0];
          task.lastErrorDetail = '岗位：' + (job.title || '') + ' @ ' + (job.company || '') + '\nBOSS 在线简历发送未确认';
          task.counters.failed += 1;
          task.consecutiveFails += 1;
          await bumpDailyStat('fail');
          await log('error', 'BOSS 在线简历发送失败：' + (resumeRes?.message || resumeRes?.error || '未确认'), {
            jobId: job.jobId
          });
          return 'failed';
        }
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
    await log('info', '开始队列投递：共 ' + queue.length + ' 岗；锚点 ' + String(task.listHref || '无').slice(0, 120));

    for (let qi = 0; qi < queue.length; qi++) {
      const row = queue[qi];
      await waitWhilePaused(task);
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
        const guard = await assertBossContext();
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
      try {
        config = await getAllConfig();
        task = config.task || task;
        if (task?.queue) {
          const q = task.queue.find((x) => x.jobId === row.job?.jobId);
          if (q) {
            q.status = outcome === 'success' ? 'done' : outcome === 'skipped' ? 'skipped' : 'failed';
            q.finishedAt = Date.now();
            q.outcome = outcome;
          }
          await publishTask(task);
        }
        await log('info', '队列项结果：' + (row.job?.title || '') + ' → ' + outcome + '（' + (qi + 1) + '/' + queue.length + '）', { jobId: row.job?.jobId });
      } catch (_) {}

      // 失败后等待用户：关闭=保持暂停不自动继续；重试=重置当前岗位后再跑一次
      while (outcome === 'failed') {
        // 回列表，避免卡在会话页
        try { await sendToBoss(MSG.RETURN_TO_LIST, {}); } catch (_) {}
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
        await waitWhilePaused(task);
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

      // 双页模式：工作页直接打开下一岗 href，正常路径不再 RETURN_TO_LIST
      // （失败暂停时 while 里仍会尝试回列表，便于用户操作）
      task.counters.processed += 1;
      task.updatedAt = Date.now();
      await publishTask(task);

      if (outcome === 'limited') break;
      if (outcome === 'aborted') break;

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
        let iv = config.settings.jobIntervalMs || [3500, 6000];
        if (Array.isArray(iv) && iv[0] < 2500) iv = [3500, 6000];
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
      task.updatedAt = Date.now();
      task.currentJobId = null;
      await publishTask(task);
    }
    return { ok: true, task };
  } catch (err) {
    await log('error', `任务异常：${err?.message || err}`);
    const config = await getAllConfig();
    if (config.task) {
      config.task.status = TASK_STATUS.FAILED;
      config.task.updatedAt = Date.now();
      await publishTask(config.task);
    }
    return { ok: false, error: String(err?.message || err) };
  } finally {
    runner.running = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message || {};
  (async () => {
    switch (type) {
      case MSG.GET_STATE: {
        const all = await getAllConfig();
        const tab = await getActiveBossTab();
        return {
          ok: true,
          ...all,
          activeTab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
          activeIsBoss: Boolean(tab),
          bossOnly: true,
          runner: { running: runner.running, pause: runner.pause }
        };
      }
      case MSG.SAVE_SETTINGS:
        await saveSettings(payload);
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
        const guard = await assertBossContext();
        if (!guard.ok) {
          await log("warn", guard.message);
          return guard;
        }
        return await runPreview(payload || {});
      }
      case MSG.CONFIRM_AND_START: {
        // CONFIRM_AND_START guard
        {
          const guard = await assertBossContext();
          if (!guard.ok) {
            await log("warn", guard.message);
            return guard;
          }
        }
        const all = await getAllConfig();
        let task = all.task;
        if (!task) return { ok: false, error: 'NO_TASK' };
        if (payload?.selectedJobIds) {
          const setIds = new Set(payload.selectedJobIds);
          task.results = (task.results || []).map((r) => ({
            ...r,
            selected: setIds.has(r.job.jobId)
          }));
          task.items = (task.items || []).map((it) => ({
            ...it,
            selected: setIds.has(it.jobId)
          }));
        }
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
        // async loop
        runTaskLoop(task.id);
        return { ok: true, taskId: task.id, splitView: split };
      }
      case MSG.RUN_TEST_DELIVERY:
      case 'BHT_RUN_TEST_DELIVERY': {
        {
          const guard = await assertBossContext();
          if (!guard.ok) {
            await log('warn', guard.message);
            return guard;
          }
        }
        const all = await getAllConfig();
        let task = all.task;
        if (!task || !(task.results || []).length) {
          return { ok: false, error: 'NO_PREVIEW', message: '请先扫描预览，再使用「投递一份测试」' };
        }
        const passRows = (task.results || []).filter((r) => r.decision === 'pass');
        if (!passRows.length) {
          return { ok: false, error: 'NO_PASS', message: '预览结果中没有通过筛选的岗位，无法测试投递' };
        }
        let pick = null;
        const wantId = payload?.jobId || (payload?.selectedJobIds && payload.selectedJobIds[0]) || null;
        if (wantId) pick = passRows.find((r) => r.job?.jobId === wantId) || null;
        if (!pick) {
          // prefer currently selected pass
          pick = passRows.find((r) => r.selected) || passRows[0];
        }
        const onlyId = pick.job.jobId;
        task.results = (task.results || []).map((r) => ({
          ...r,
          selected: r.job?.jobId === onlyId && r.decision === 'pass'
        }));
        task.items = (task.items || []).map((it) => ({
          ...it,
          selected: it.jobId === onlyId
        }));
        // force one-shot limit for this task instance
        task.testDelivery = true;
        task.testJobId = onlyId;
        task.status = TASK_STATUS.RUNNING;
        task.pauseReason = '';
        task.awaitingUserRetry = false;
        const split = await prepareSplitWorkspace(task, all.settings || {});
        await publishTask(task);
        if (split.ok) {
          await log('success', '[分屏] 测试投递已打开左右工作区', {
            listTabId: split.listTabId,
            messageTabId: split.messageTabId
          });
        } else if (!split.skipped) {
          await log('warn', '[分屏] ' + (split.message || '自动分屏不可用，已回退为普通标签页'));
        }
        await log(
          'info',
          '测试投递启动：仅处理 1 个岗位「' + (pick.job?.title || '') + '」@ ' + (pick.job?.company || ''),
          { jobId: onlyId }
        );
        // temporary settings override for this run only (in-memory via task flags; limits still apply normally but queue size=1)
        runTaskLoop(task.id);
        return { ok: true, testJobId: onlyId, job: pick.job, splitView: split };
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
              const curId = all0.task.currentJobId;
              all0.task.items = (all0.task.items || []).map((it) => {
                if (curId && it.jobId === curId && it.state === 'FAILED') {
                  return { ...it, state: 'NOT_STARTED', reasons: [] };
                }
                // 无 currentJobId 时，仅重置最近一个 FAILED
                return it;
              });
              if (!all0.task.currentJobId) {
                const lastFail = [...(all0.task.items || [])].reverse().find((it) => it.state === 'FAILED');
                if (lastFail) {
                  all0.task.items = all0.task.items.map((it) =>
                    it.jobId === lastFail.jobId ? { ...it, state: 'NOT_STARTED', reasons: [] } : it
                  );
                  all0.task.currentJobId = lastFail.jobId;
                }
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
          const guard = await assertBossContext();
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
        runner.abort = true;
        runner.pause = false;
        {
          const all = await getAllConfig();
          if (all.task) {
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
        runner.skipCurrent = true;
        // 若在等待用户重试的暂停中，允许跳过后继续
        if (runner.pause) {
          const all = await getAllConfig();
          if (all.task) {
            all.task.awaitingUserRetry = false;
            // mark current failed/paused item skipped if possible
            if (all.task.currentJobId && all.task.items) {
              all.task.items = all.task.items.map((it) =>
                it.jobId === all.task.currentJobId && (it.state === 'FAILED' || it.state === 'NOT_STARTED' || it.state === 'COMMUNICATION_CREATED')
                  ? { ...it, state: 'SKIPPED', reasons: ['用户跳过'] }
                  : it
              );
            }
            await publishTask(all.task);
          }
          runner.pause = false;
        }
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
        await importAll(payload?.data || payload, { merge: Boolean(payload?.merge) });
        return { ok: true };
      case MSG.GET_LOGS:
        return { ok: true, logs: await getLogs(payload?.limit || 200) };
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
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

// 供调试
globalThis.__BHT_BG__ = { runner, runPreview };
