import { MSG } from '../shared/messaging.js';
import {
  appendHistory,
  appendLog,
  bumpDailyStat,
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

let runner = {
  running: false,
  abort: false,
  pause: false,
  skipCurrent: false,
  pauseLogged: false
};

chrome.runtime.onInstalled.addListener(async () => {
  await getAllConfig();
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

async function sendToBoss(type, payload = {}, { retries = 1 } = {}) {
  const tab = await getActiveBossTab({ allowInactiveBossTab: false });
  if (!tab?.id) {
    const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return {
      ok: false,
      error: "NO_BOSS_TAB",
      message: bossUrlGuardMessage(active?.url || "")
    };
  }
  // 注入前再次校验 URL，防止标签在异步过程中导航到非 BOSS 页
  if (!isBossUrl(tab.url || "")) {
    return {
      ok: false,
      error: "NOT_BOSS_URL",
      message: bossUrlGuardMessage(tab.url || "")
    };
  }
  try {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type, payload });
    } catch (err0) {
      const msg0 = String(err0?.message || err0 || '');
      if (retries > 0 && /message channel closed|Receiving end does not exist|asynchronous response/i.test(msg0)) {
        // channel closed retry
        await sleep(700);
        return sendToBoss(type, payload, { retries: retries - 1 });
      }
      throw err0;
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
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content-main.js"],
        injectImmediately: true
      });
      await sleep(200);
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

async function runPreview(payload = {}) {
  await log('info', '开始扫描预览…');
  const config = await getAllConfig();
  const scan = await sendToBoss(MSG.SCAN_JOBS, { scroll: payload.scroll !== false, maxRounds: payload.maxRounds || 6 });
  if (!scan?.ok) {
    await log('error', scan?.message || '扫描失败', { error: scan?.error });
    return { ok: false, ...scan };
  }

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
    consecutiveFails: 0
  };

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
  const job = resultRow.job;
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

  await log('info', `开始沟通：${job.title} @ ${job.company || ''}`, { jobId: job.jobId });



// ENSURE_JOB_LIST before start (轻量：真正查找+点击都在 START_CHAT 原子完成)
  {
    try { await sendToBoss(MSG.CLOSE_CHAT, {}); } catch (_) {}
    await sleep(200);
    try {
      const ensured = await sendToBoss(MSG.ENSURE_JOB_LIST, { maxWaitMs: 5000, scroll: false });
      if (ensured && ensured.ok === false) {
        await log('warn', ensured.message || '职位列表暂未就绪，将直接按标题查找', { jobId: job.jobId });
      }
    } catch (_) {}
    await sleep(150);
  }
  const chatRes = await sendToBoss(MSG.START_CHAT, { job, skipScroll: true });
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

  // messages
  const selfRes = await sendToBoss(MSG.GET_CHAT_SELF_MESSAGES, { limit: 8 });
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

    const sendRes = await sendToBoss(MSG.SEND_TEXT, { text: step.text });
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
    item.state = step.stateName;
    await log('success', `已发送第 ${step.index + 1} 段消息`, { jobId: job.jobId });
    await sleep(randomBetween(config.settings.segmentIntervalMs));
  }

  // resume
  const profile = pickResumeProfile(job, config.resumes, config.bindings);
  const timing = config.settings.resumeSendTiming;
  const shouldSendResume = timing === 'after_text';

  if (shouldSendResume && profile) {
    if (config.settings.autoSendImageResume && profile.images?.length) {
      for (let i = 0; i < profile.images.length; i++) {
        const img = profile.images[i];
        const key = resumeIdempotencyKey(job, `image_${i}`, profile.id);
        if (await hasIdempotent(key)) continue;
        const imgRes = await sendToBoss(MSG.SEND_IMAGE, {
          dataUrl: img.dataUrl,
          fileName: img.name || `resume_${i + 1}.png`
        });
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
    // 附件：页面上传控件差异大，记录意图，提示用户必要时手动
    if (config.settings.autoSendAttachmentResume && profile.attachment?.dataUrl) {
      const key = resumeIdempotencyKey(job, 'file', profile.id);
      if (!(await hasIdempotent(key))) {
        const fileRes = await sendToBoss(MSG.SEND_IMAGE, {
          dataUrl: profile.attachment.dataUrl,
          fileName: profile.attachment.name || 'resume.pdf'
        });
        if (fileRes?.ok) {
          await markIdempotent(key, { jobId: job.jobId });
          item.state = 'ATTACHMENT_RESUME_SENT';
          await log('success', '附件简历已尝试发送', { jobId: job.jobId });
        } else {
          await log('warn', '附件简历自动发送不可用，请在聊天中手动发送', { jobId: job.jobId });
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

  // RETURN_TO_LIST after job
  {
    const back = await sendToBoss(MSG.RETURN_TO_LIST, {});
    if (!back?.ok) {
      await log('warn', back?.message || '返回职位列表失败，尝试继续', { jobId: job.jobId });
      await sleep(800);
    } else {
      await sleep(randomBetween(config.settings.jobIntervalMs || [1200, 2200]));
    }
  }

  item.state = 'COMPLETED';
  item.reasons = [reasonText(REASON.OK_ITEM_COMPLETED)];
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

    const queue = (task.results || []).filter((r) => r.selected && r.decision === 'pass');
    for (const row of queue) {
      await waitWhilePaused(task);
      if (runner.abort) break;

      // refresh config each item for live setting changes
      config = await getAllConfig();
      task = config.task;
      if (!task) break;

      const item = task.items.find((x) => x.jobId === row.job.jobId);
      if (item && (item.state === 'COMPLETED' || item.state === 'SKIPPED')) {
        continue;
      }

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
      const outcome = await processOneJob(task, row, config);
      // ENSURE_JOB_LIST between jobs
      if (outcome === 'success' || outcome === 'failed' || outcome === 'skipped') {
        await sendToBoss(MSG.RETURN_TO_LIST, {});
        await sleep(500);
      }
      // awaitingUserRetry on fail
      if (outcome === 'failed') {
        task.status = TASK_STATUS.PAUSED;
        task.awaitingUserRetry = true;
        task.pauseReason = task.pauseReason || itemErrorHint(task, row) || '岗位处理失败，请查看原因后重试';
        task.lastErrorDetail = [
          '岗位：' + (row.job?.title || ''),
          '公司：' + (row.job?.company || ''),
          '原因：' + ((task.items.find(x => x.jobId === row.job.jobId) || {}).reasons || []).join('；')
        ].filter(Boolean).join('\n');
        runner.pause = true;
        await publishTask(task);
        // 等用户点重试/关闭；不再重复 log pauseReason（processOneJob 已记录）
        await waitWhilePaused(task);
        if (runner.abort) break;
        // 用户点重试后，不增加 processed 重复？已失败计一次
      }
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
        await log('warn', '任务已停止');
      } else if (task.status === TASK_STATUS.PAUSED || runner.pause) {
        task.status = TASK_STATUS.PAUSED;
        await log('warn', task.pauseReason || '任务已暂停');
      } else {
        task.status = TASK_STATUS.COMPLETED;
        await log('success', '任务已完成');
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
        await publishTask(task);
        // async loop
        runTaskLoop(task.id);
        return { ok: true, taskId: task.id };
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
        if (true) {
          const all0 = await getAllConfig();
          if (all0.task) {
            all0.task.awaitingUserRetry = false;
            all0.task.pauseReason = '';
            all0.task.lastErrorDetail = '';
            await publishTask(all0.task);
          }
          runner.pauseLogged = false;
          runner.pausePublished = false;
          // reset FAILED for retry
          {
            const all1 = await getAllConfig();
            if (all1.task?.items) {
              all1.task.items = all1.task.items.map((it) =>
                it.state === 'FAILED' ? { ...it, state: 'NOT_STARTED', reasons: [] } : it
              );
              all1.task.consecutiveFails = 0;
              await publishTask(all1.task);
            }
          }
        }
        // RESUME_TASK guard
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
        await log('info', '继续任务');
        return { ok: true };
      }
      case MSG.STOP_TASK:
        runner.abort = true;
        runner.pause = false;
        {
          const all = await getAllConfig();
          if (all.task) {
            all.task.status = TASK_STATUS.STOPPED;
            await publishTask(all.task);
          }
        }
        await log('warn', '用户停止任务');
        return { ok: true };
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
        // 用户关闭错误弹窗：保持暂停，但清除 awaitingUserRetry，避免反复弹窗
        runner.pause = true;
        const all = await getAllConfig();
        if (all.task) {
          all.task.awaitingUserRetry = false;
          all.task.status = TASK_STATUS.PAUSED;
          all.task.updatedAt = Date.now();
          // 保留 pauseReason 便于状态栏显示，但不再驱动弹窗
          await publishTask(all.task);
        }
        await log('warn', '用户关闭错误提示，任务保持暂停');
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
