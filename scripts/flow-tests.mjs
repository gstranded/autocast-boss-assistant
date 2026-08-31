import assert from "assert";
import fs from "fs";
import { isBossUrl } from "../extension/shared/boss-url.js";
import { planMessageSegments } from "../extension/shared/message-planner.js";
import { MESSAGE_MODES } from "../extension/shared/constants.js";

console.log("8) delivery flow contracts");
const registeredTests = [];
function test(name, fn) {
  registeredTests.push({ name, fn });
}

async function runRegisteredTests() {
  for (const { name, fn } of registeredTests) {
    try { await fn(); console.log("  PASS", name); }
    catch (e) { console.error("  FAIL", name, e.message); process.exitCode = 1; }
  }
}

test("content exposes return/ensure/close handlers", () => {
  const s = fs.readFileSync("extension/content/content-main.js", "utf8");
  for (const k of [
    "ensureJobList",
    "returnToJobList",
    "closeChatPanel",
    "preventLinkNavigation",
    "SEND_NOT_CONFIRMED",
    "BHT_RETURN_TO_LIST",
    "BHT_ENSURE_JOB_LIST"
  ]) assert.ok(s.includes(k), "missing " + k);
});

test("preview auto-recovers non-list pages without silent zero results", () => {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const panel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(content.includes('error: "LIST_NAV_REQUIRED"'));
  assert.ok(content.includes("shouldNavigate: !noHomeNav"));
  assert.ok(content.includes("getJobListNavigationTarget"));
  assert.ok(content.includes("BHT_CONTENT_INSTANCE_ID"));
  assert.ok(content.includes("window.__BHT_CONTENT_INSTANCE_ID__"));
  assert.ok(content.includes("const updates = {}"));
  assert.ok(content.includes('via: "saved-list-navigation-required"'));
  assert.ok(background.includes("navigatePreviewToJobList"));
  assert.ok(background.includes("scan?.error === 'NAVIGATED'"));
  assert.ok(background.includes("scan_navigation_detected"));
  assert.ok(background.includes("didContentDocumentChange"));
  assert.ok(background.includes("resolvePageOperationTimeoutMs"));
  assert.ok(background.includes("resolveBridgeTimeoutMs"));
  assert.ok(background.includes("OP_BRIDGE_TIMEOUT"));
  assert.ok(!background.includes("扫描等待超过 38 秒"));
  assert.ok(background.includes("scan?.shouldNavigate === true"));
  assert.ok(panel.includes("非列表页会自动跳转"));
  assert.ok(panel.includes("下方暂时仍是上一次预览"));
  assert.ok(panel.includes("取消本次扫描（保留上一次预览结果）"));
  assert.ok(panel.includes("已连接 BOSS · 列表未就绪"));
});

test("background force-injects content on critical ops", () => {
  const s = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(s.includes("forceInjectContent"));
  assert.ok(s.includes("critical.includes"));
});

test("boss context prefers the panel sender tab over the focused window tab", () => {
  const s = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(s.includes("async function tabFromSender"));
  assert.ok(s.includes("assertBossContext(sender)"));
  assert.ok(s.includes("getActiveBossTab({ sender })"));
  assert.ok(s.includes("isBossTab(fromSender)"));
  assert.ok(s.includes("let { payload }"));
});

test("background uses the two-page trigger flow and returns safely after failures", () => {
  const s = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(s.includes("TRIGGER_CONVERSATION"));
  assert.ok(s.includes("RETURN_TO_LIST") && (s.includes("返回列表统一由 runTaskLoop") || s.includes("每岗结束后只回列表一次")));
  assert.ok(s.includes("RETURN_TO_LIST after fail"));
  assert.ok(s.includes("RETURN_TO_LIST after send fail"));
  assert.ok(s.includes("retryCurrent"));
  assert.ok(s.includes("payload?.retry"));
  assert.ok(s.includes("while (outcome === 'failed')"));
});

test("successful conversation creation survives a forced list-to-chat navigation", () => {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const recovery = fs.readFileSync("extension/shared/trigger-navigation-recovery.js", "utf8");
  const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
  const isolated = manifest.content_scripts.find((entry) => !entry.world || entry.world === "ISOLATED");
  assert.ok(isolated?.js?.includes("shared/trigger-navigation-recovery.js"));
  assert.ok(content.includes("trigger_navigation_recovered"));
  assert.ok(content.includes("window.__BHT_LAST_TRIGGER_CLICK__"));
  assert.ok(content.includes("for (let i = 0; i < 18 && !stay.ok; i++)"));
  assert.ok(recovery.includes("receiptMatches"));
  assert.ok(recovery.includes("navigationRecovered: true"));
  assert.ok(background.includes("restoreListTabAfterTriggerNavigation"));
  assert.ok(background.includes("BOSS 在沟通成功后跳到聊天页"));
});

test("conversation trigger uses a temporary inactive worker and never navigates the left list", () => {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const worker = fs.readFileSync("extension/shared/conversation-worker.js", "utf8");
  assert.ok(worker.includes("buildConversationWorkerAttempts"));
  assert.ok(worker.includes("isListDocumentPreserved"));
  assert.ok(background.includes("triggerConversationInWorker"));
  assert.ok(background.includes("openConversationWorkerTab"));
  assert.ok(background.includes("active: false"));
  assert.ok(background.includes("workerDetail: attempt.mode === CONVERSATION_WORKER_MODE.DETAIL"));
  assert.ok(background.includes("closeConversationWorkerTab"));
  assert.ok(background.includes("左侧职位页保持原样"));
  assert.ok(content.includes("triggerConversationOnWorkerDetail"));
  assert.ok(content.includes("worker_detail_chat_button_clicked"));
  assert.ok(!background.includes("let listOpt = null"));
});

test("worker detail clicks the exact chat action and requires a creation receipt", () => {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  assert.ok(content.includes("findConversationActionButton"));
  assert.ok(content.includes("/^(立即沟通|继续沟通|打招呼)$/"));
  assert.ok(content.includes("if (!explicitlyInteractive && /wrap|container/i.test(className)) continue"));
  assert.ok(content.includes('error: "CONVERSATION_CREATE_NOT_CONFIRMED"'));
  assert.ok(content.includes("!clicked.already && !nativeGreeting.available"));
  assert.ok(content.includes("worker_detail_trigger_unconfirmed"));
});

test("message conversation matching performs a second real reload after propagation delay", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const branchStart = background.indexOf("首次刷新后暂未出现新会话");
  assert.ok(branchStart > 0);
  const retryBranch = background.slice(branchStart, branchStart + 1300);
  assert.ok(retryBranch.includes("refreshMessageTabOnce"));
  assert.ok(retryBranch.includes("timeoutMs: 14000"));
  assert.ok(background.includes("if (!resumedFromChat) await sleep(700)"));
});

test("autosave protects IME composition and never rebuilds message inputs", () => {
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(app.includes("AUTOSAVE_DELAY_MS = 1800"));
  assert.ok(app.includes("compositionstart"));
  assert.ok(app.includes("compositionend"));
  assert.ok(app.includes("e.isComposing"));
  assert.ok(app.includes("autosaveComposingTarget"));
  const flushStart = app.indexOf("async function flushAutosave");
  const flushEnd = app.indexOf("function scheduleAutosave", flushStart);
  const flush = app.slice(flushStart, flushEnd);
  assert.ok(!flush.includes("renderSegments("));
  assert.ok(!flush.includes("refresh({ soft: true })"));
  assert.ok(!flush.includes("toast("));
  assert.ok(flush.includes("render: false"));
});

test("preview accumulates virtualized jobs until bottom or the 60 second deadline", () => {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const panel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(content.includes("scanAdaptiveJobBatch"));
  assert.ok(content.includes("window.__BHT_SCAN_SESSION__"));
  assert.ok(content.includes("session.jobs = new Map") || content.includes("jobs: new Map()"));
  assert.ok(content.includes("visibleChanged"));
  assert.ok(content.includes("bottomStableRounds"));
  assert.ok(content.includes("lastGrowthAt"));
  assert.ok(content.includes("先轻微回拉再触底"));
  assert.ok(content.includes("deadlineAt"));
  assert.ok(content.includes("timedOut"));
  assert.ok(content.includes("scroller.scrollTop = scroller.scrollHeight"));
  assert.ok(content.includes("payload.deltaOnly === true"));
  assert.ok(content.includes("returnedCount"));
  assert.ok(content.includes("continuingSession"));
  const continuationStart = content.indexOf("const continuingSession =");
  const continuationEnd = content.indexOf("const ensured = continuingSession", continuationStart);
  const continuationGuard = content.slice(continuationStart, continuationEnd);
  assert.ok(continuationGuard.includes("isListLikePage()"));
  assert.ok(!continuationGuard.includes("jobs?.size > 0"));
  assert.ok(!continuationGuard.includes("getJobCards().length"));
  assert.ok(content.includes("只按 pathname 判断"));
  assert.ok(content.includes("collected.visibleCount > 0"));
  assert.ok(background.includes("maxScanMs || OPERATION_TIMEOUTS.PREVIEW_SCROLL_MS"));
  assert.ok(background.includes("mergePreviewJobBatch"));
  assert.ok(background.includes("deltaOnly: true"));
  assert.ok(background.includes("payload.batchRounds || 3"));
  assert.ok(background.includes("滚动阶段只采集和去重；确认到底或到达统一截止时间后，才执行一次筛选"));
  assert.ok(!background.includes("targetPass"));
  assert.ok(!background.includes("maxScanJobs"));
  assert.ok(background.includes("collecting"));
  assert.ok(background.includes("scanStartedAt + maxElapsedMs"));
  assert.ok(background.includes("resolvePreviewScanStop"));
  assert.ok(background.includes("滚动阶段只采集和去重"));
  assert.ok(background.includes("SCAN_WORKER_OPEN_FAILED"));
  assert.ok(!background.includes("临时页初次扫描失败，回退原职位页"));
  assert.ok(panel.includes("到达列表底部或 60 秒"));
});

test("page operations consume the background budget and keep timeout terminal states distinct", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const dispatchGate = fs.readFileSync("extension/shared/operation-dispatch-gate.js", "utf8");
  const policy = fs.readFileSync("extension/shared/operation-timeouts.js", "utf8");
  assert.ok(policy.includes("PREVIEW_SCROLL_MS: 60000"));
  assert.ok(policy.includes("BRIDGE_GRACE_MS: 5000"));
  assert.ok(policy.includes("BRIDGE_CANCEL_SETTLE_MS: 3000"));
  assert.ok(background.includes("__bhtOperationTimeoutMs: pageOperationTimeoutMs"));
  assert.ok(background.includes("操作结果通道超过统一预算，取消页面内旧操作"));
  assert.ok(background.includes("waitForBridgeCancellationSettlement"));
  assert.ok(background.includes("removeStorage: bridgeSettled"));
  assert.ok(background.includes("operations.delete(bridgeOpId)"));
  assert.ok(background.includes("more?.error === 'OP_DEADLINE_EXCEEDED'"));
  assert.ok(!background.includes("['OP_DEADLINE_EXCEEDED', 'OP_BRIDGE_TIMEOUT']"));
  assert.ok(content.includes("requestedOperationTimeoutMs"));
  assert.ok(content.includes("__BHT_ACTIVE_OP_TYPE__ === MSG.SCAN_JOBS"));
  assert.ok(content.includes("原操作可能还在收尾；保留取消墓碑"));
  assert.ok(!content.includes("if (window.__BHT_DEBUG_ENABLED__ !== true || !window.__BHT_ACTIVE_OP_ID__) return;"));
  assert.ok(content.includes('error: "OP_DEADLINE_EXCEEDED"'));
  assert.ok(content.includes("!timedOut && opId"));
  assert.ok(content.includes("markSettledCancellation"));
  const gateStart = content.indexOf("const dispatchGate");
  const bootstrapEnd = content.indexOf("const requestedOperationTimeoutMs", gateStart);
  const bootstrap = content.slice(gateStart, bootstrapEnd);
  assert.ok(bootstrap.includes("await dispatchGate"));
  assert.ok(bootstrap.includes("readOperationState"));
  assert.ok(bootstrap.includes("settleCancellation"));
  assert.ok(!bootstrap.includes('status: "pending"'));
  assert.ok(bootstrap.indexOf("if (!permit.ok) return") < content.indexOf("workPromise =", gateStart));
  assert.ok(dispatchGate.includes('row?.status === "cancelled"'));
  assert.ok(content.includes('settled: true'));
  assert.ok(!content.includes('error: "OP_INNER_TIMEOUT"'));
  assert.ok(!content.includes("sleep(15000).then"));
});

test("cancelled preview generations cannot filter or publish late results", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const panel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const runPreviewStart = background.indexOf("async function runPreview");
  const runPreviewEnd = background.indexOf("function itemErrorHint", runPreviewStart);
  const runPreview = background.slice(runPreviewStart, runPreviewEnd);
  const stopStart = background.indexOf("case MSG.STOP_TASK");
  const stopEnd = background.indexOf("case MSG.SKIP_CURRENT", stopStart);
  const stop = background.slice(stopStart, stopEnd);
  assert.ok(background.includes("previewRunId"));
  assert.ok(background.includes("isPreviewRunActive"));
  assert.ok(runPreview.includes("if (!isActive()) return cancelled();"));
  assert.ok(runPreview.includes("const results = evaluatePreviewResults"));
  assert.ok(runPreview.indexOf("if (!isActive()) return cancelled();", runPreview.indexOf("const todayStats")) > -1);
  assert.ok(runPreview.includes("await publishPreviewTask(task, previewRunId"));
  assert.ok(background.includes("task.previewRunId = previewRunId"));
  assert.ok(background.includes("discardCancelledPreviewTask(previewRunId"));
  const previewPublisherStart = background.indexOf("async function publishPreviewTask");
  const previewPublisherEnd = background.indexOf("async function withRunnerAdmission", previewPublisherStart);
  const previewPublisher = background.slice(previewPublisherStart, previewPublisherEnd);
  assert.ok(previewPublisher.indexOf("task.previewRunId = previewRunId") < previewPublisher.indexOf("await publishTask(task)"));
  assert.ok(stop.includes("const cancelledPreviewRunId = runner.previewRunId"));
  assert.ok(stop.includes("const previousPreviewTask = runner.previewPreviousTask"));
  assert.ok(stop.includes("const previewRunPromise = activePreviewRun?.id === cancelledPreviewRunId"));
  assert.ok(stop.indexOf("await cancelActiveOperations('用户取消扫描预览')") < stop.indexOf("await discardCancelledPreviewTask(cancelledPreviewRunId, previousPreviewTask)"));
  assert.ok(stop.indexOf("await previewRunPromise") < stop.indexOf("await discardCancelledPreviewTask(cancelledPreviewRunId, previousPreviewTask)"));
  assert.ok(background.includes("String(current?.previewRunId || '') !== String(previewRunId)"));
  assert.ok(background.includes("authoritative: true"));
  assert.ok(background.includes("preview_cancel_rollback"));
  assert.ok(panel.includes("authoritativeTask"));
  assert.ok(panel.includes("msg.authoritative === true"));
  assert.ok(panel.includes("Object.prototype.hasOwnProperty.call(res, 'task')"));
  assert.ok(stop.indexOf("runner.previewRunId = ''") < stop.indexOf("await cancelActiveOperations"));
  assert.ok(stop.indexOf("runner.previewing = false") > stop.indexOf("await discardCancelledPreviewTask"));
  const sendStart = background.indexOf("async function sendToBoss");
  const sendEnd = background.indexOf("async function assertBossContext", sendStart);
  const sendToBoss = background.slice(sendStart, sendEnd);
  assert.ok(sendToBoss.includes("const runKind = previewRunId ? 'preview'"));
  const workerStart = background.indexOf("async function openPreviewScanWorker");
  const workerEnd = background.indexOf("async function closePreviewScanWorker", workerStart);
  const worker = background.slice(workerStart, workerEnd);
  assert.ok(worker.includes("if (previewRunId && !isPreviewRunActive(previewRunId))"));
  assert.ok(worker.indexOf("await sleep(250)") < worker.lastIndexOf("if (previewRunId && !isPreviewRunActive(previewRunId))"));
  assert.ok(runPreview.indexOf("await openPreviewScanWorker") < runPreview.indexOf("if (!isActive())", runPreview.indexOf("await openPreviewScanWorker")));
});

test("preview scanning isolates DOM work and uses lightweight one-second status updates", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const panel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const host = fs.readFileSync("extension/content/floating-host.js", "utf8");
  const debugLog = fs.readFileSync("extension/shared/debug-log.js", "utf8");
  assert.ok(background.includes("openPreviewScanWorker"));
  assert.ok(background.includes("active: false"));
  assert.ok(background.includes("sourcePage?.savedListHref"));
  assert.ok(background.includes("listExpectLabel: scanWorkerTab.savedListExpectLabel ||"));
  assert.ok(background.includes("const workerCandidates"));
  assert.ok(background.includes("sourcePageHref"));
  assert.ok(background.includes("taskListHref"));
  assert.ok(background.includes("workerUrl = workerListHref || resolveBossJobListUrl"));
  assert.ok(background.includes("if (!sourceTab?.id) return null"));
  assert.ok(content.includes("savedListHref: savedHref"));
  assert.ok(content.includes("savedListFilterHints"));
  assert.ok(content.includes("listHref,"));
  assert.ok(content.includes("listFilterHints"));
  assert.ok(content.includes("payload.listExpectLabel && isListLikePage()"));
  assert.ok(background.includes("closePreviewScanWorker"));
  assert.ok(background.includes("isolatedWorker: scanWorkerUsed"));
  assert.ok(background.includes("GET_RUNNER_STATE"));
  assert.ok(background.includes("pause/abort/skip 只能来自上一轮残留"));
  assert.ok(panel.includes("refreshRunnerState"));
  assert.ok(panel.includes("}, 1000)"));
  assert.ok(panel.includes("isPollingRequest"));
  assert.ok(panel.includes("lastPreviewRenderKey"));
  assert.ok(panel.includes("document.createDocumentFragment"));
  assert.ok(panel.includes("lastLogRenderKey"));
  assert.ok(panel.includes("lastHistoryRenderKey"));
  assert.ok(host.includes("sessionStorage.setItem(STORAGE_OPEN"));
  assert.ok(host.includes("cmd: \"suspend\""));
  assert.ok(content.includes("summarizeOperationResult"));
  assert.ok(background.includes("summarizeBossOperationResult"));
  assert.ok(debugLog.includes("items omitted"));
  assert.ok(!content.includes("jobs.slice(0, 80)"));
});

test("preview never falls back to scrolling the source tab", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const runStart = background.indexOf("async function runPreview");
  const runEnd = background.indexOf("function itemErrorHint", runStart);
  const run = background.slice(runStart, runEnd);
  assert.ok(run.includes("openPreviewScanWorker(sourcePreviewTab, previewRunId"));
  assert.ok(run.includes("if (!scanWorkerTab)"));
  assert.ok(run.includes("SCAN_WORKER_OPEN_FAILED"));
  assert.ok(run.includes("previewTab = scanWorkerTab"));
  assert.ok(!run.includes("scanWorkerTab || sourcePreviewTab"));
  assert.ok(!run.includes("previewTab = sourcePreviewTab || previewTab"));
  assert.ok(run.includes("listHref: payload.listHref || taskListHref"));
  assert.ok(run.includes("listExpectLabel: payload.listExpectLabel || taskListExpectLabel"));
});

test("panel and background reject mixed extension versions before delivery", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const panel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(background.includes("EXTENSION_VERSION_MISMATCH"));
  assert.ok(background.includes("BHT_RUNTIME_VERSION"));
  assert.ok(background.includes("content_version_reinject"));
  assert.ok(background.includes("CONTENT_VERSION_MISMATCH"));
  assert.ok(background.includes("legacyProtocol: 'BHT_SEND_RESUME'"));
  assert.ok(panel.includes("clientVersion: BHT_UI_VERSION"));
  assert.ok(panel.includes("showRuntimeMismatchBanner"));
  assert.ok(panel.includes("已停止投递"));
});

test("content operation bridge is versioned and cancellable", () => {
  const s = fs.readFileSync("extension/content/content-main.js", "utf8");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.ok(s.includes(`BHT_CONTENT_VERSION = "${pkg.version}"`));
  assert.ok(s.includes("matchedVia"));
  assert.ok(s.includes("tryPickVisible"));
  assert.ok(s.includes("JOB_CARD_NOT_FOUND"));
  assert.ok(s.includes("runOpByType"));
  assert.ok(s.includes("setInputText"));
  assert.ok(s.includes("findSendButton"));
  assert.ok(s.includes("getSelfMessages"));
  assert.ok(s.includes("BHT_RUN_OP") || s.includes("bht_op_"));
  assert.ok(s.includes("openJobByHrefFallback"));
  assert.ok(s.includes("operationCancelledError"));
  assert.ok(s.includes("BHT_CANCEL_OP"));
  assert.ok(!s.includes("runtime.onConnect"));
  assert.ok(!s.includes("resumePendingOps"));
  assert.ok(s.includes("uiErrorDismissed") === false); // content may not have it
});

test("background modal dismiss flag + cancellable conversation trigger", () => {
  const s = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(s.includes("uiErrorDismissed"));
  assert.ok(s.includes("MSG.TRIGGER_CONVERSATION"));
  assert.ok(s.includes("cancelActiveOperations"));
  assert.ok(s.includes("active.map((operation) => cancelBridgeOperation({ ...operation, reason }))"));
  assert.ok(s.includes("DISMISS_ERROR_MODAL"));
});

test("message protocol includes list control", () => {
  const s = fs.readFileSync("extension/shared/messaging.js", "utf8");
  assert.ok(s.includes("ENSURE_JOB_LIST"));
  assert.ok(s.includes("RETURN_TO_LIST"));
  assert.ok(s.includes("CLOSE_CHAT"));
});

test("greeting control covers platform receipt, safe pause, account write and readback", () => {
  const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
  const hook = fs.readFileSync("extension/content/page-network-hook.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const planner = fs.readFileSync("extension/shared/message-planner.js", "utf8");
  const panel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const html = fs.readFileSync("extension/sidepanel/index.html", "utf8");
  const mainEntry = manifest.content_scripts.find((entry) => entry.world === "MAIN");
  assert.ok(mainEntry?.js?.includes("content/page-network-hook.js"));
  assert.equal(mainEntry?.run_at, "document_start");
  assert.ok(hook.includes("/wapi\\/zpgeek\\/friend\\/add"));
  assert.ok(hook.includes("showGreeting"));
  assert.ok(content.includes("/wapi/zpchat/greeting/getGreetingList"));
  assert.ok(content.includes("/wapi/zpchat/greeting/updateGreetingV2"));
  assert.ok(content.includes("/wapi/zpchat/greeting/custom/saveV2"));
  assert.ok(content.includes('"zp_token"'));
  assert.ok(content.includes("after.enabled !== enabled"));
  assert.ok(background.includes("waitForFreshSelfMessages"));
  assert.ok(background.includes("baselineMessages"));
  assert.ok(planner.includes("NATIVE_GREETING_UNKNOWN"));
  assert.ok(background.includes("已暂停以避免重复"));
  assert.ok(panel.includes("confirmBossGreetingChange"));
  assert.ok(panel.includes("MSG.SET_BOSS_GREETING"));
  assert.ok(panel.includes("MSG.SAVE_BOSS_GREETING_TEXT"));
  for (const id of [
    "bossGreetingToggle",
    "bossGreetingText",
    "btnSaveBossGreetingText",
    "bossGreetingConfirm",
    "pluginTextEnabled",
    "messageFlowPreview"
  ]) assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
  assert.ok(html.includes("建议关闭 BOSS 自动招呼"));
  assert.ok(html.includes('href="https://www.zhipin.com/web/geek/notify-set?type=greetSet"'));
});

test("real-time logs sort by timestamp and include dates", () => {
  const storage = fs.readFileSync("extension/shared/storage.js", "utf8");
  const panel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const order = fs.readFileSync("extension/shared/log-order.js", "utf8");
  assert.ok(storage.includes("logWriteChain"));
  assert.ok(storage.includes("sortLogsNewestFirst"));
  assert.ok(panel.includes("sortLogsNewestFirst(logs)"));
  assert.ok(panel.includes("sortLogsOldestFirst(logs)"));
  assert.ok(panel.includes("formatLogTimestamp"));
  assert.ok(order.includes("includeDate = true"));
});

test("native greeting skip still works with multi segment", () => {
  const plan = planMessageSegments({
    mode: MESSAGE_MODES.AUTO_DETECT,
    template: {
      version: 2,
      segments: [
        { id: "1", enabled: true, text: "你好，我对{职位名称}感兴趣" },
        { id: "2", enabled: true, text: "这是第二段补充" },
        { id: "3", enabled: true, text: "这是第三段补充" }
      ]
    },
    job: { jobId: "j2", bossId: "b2", title: "后端" },
    recentSelfMessages: ["你好，我对后端感兴趣"],
    threshold: 0.85,
    idempotency: {}
  });
  assert.equal(plan.startIndex, 1);
  assert.equal(plan.plan.length, 2);
  assert.ok(plan.plan[0].text.includes("第二段"));
});

test("plugin_only mode sends all enabled segments", () => {
  const plan = planMessageSegments({
    mode: MESSAGE_MODES.PLUGIN_ONLY,
    template: {
      version: 1,
      segments: [
        { id: "1", enabled: true, text: "第一段" },
        { id: "2", enabled: false, text: "停用" },
        { id: "3", enabled: true, text: "第三段" }
      ]
    },
    job: { jobId: "j3", bossId: "b3", title: "x" },
    recentSelfMessages: [],
    threshold: 0.85,
    idempotency: {}
  });
  assert.equal(plan.startIndex, 0);
  assert.equal(plan.plan.length, 2);
});

test("non boss url blocked by helper", () => {
  assert.equal(isBossUrl("https://www.zhipin.com/web/geek/chat"), true);
  assert.equal(isBossUrl("https://example.com/chat"), false);
});

test("delivery hardening contracts", () => {
  const s = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const a = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const c = fs.readFileSync("extension/content/content-main.js", "utf8");
  assert.ok(s.includes("reconcileStaleRunningTask"));
  assert.ok(s.includes("error: 'ALREADY_RUNNING'"));
  assert.ok(a.includes("ensureConfigSavedBeforeDelivery"));
  assert.ok(c.includes("waitForImageSendConfirm"));
});

test("preview UI falls back to reasonTexts and shows pass-rate warnings", () => {
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const engine = fs.readFileSync("extension/shared/filter-engine.js", "utf8");
  assert.ok(engine.includes("export function previewReasonLines"));
  assert.ok(app.includes("previewReasonLines(r)"));
  assert.ok(app.includes("task.warnings.join"));
  assert.ok(app.includes("通过率超过 80%") === false);
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(background.includes("通过率超过 80%，请检查筛选是否过宽"));
});

test("history/config controls and image-only resume stay on shipped paths", () => {
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const worker = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const html = fs.readFileSync("extension/sidepanel/index.html", "utf8");
  const css = fs.readFileSync("extension/sidepanel/styles.css", "utf8");
  assert.ok(app.includes("filterHistoryRows(history, filter)"));
  assert.ok(app.includes("btnExportHistory"));
  assert.ok(app.includes("JSON.stringify(history"));
  assert.ok(app.includes("CLEAR_HISTORY"));
  assert.ok(app.includes("$('btnImport')"));
  assert.ok(html.includes('id="btnExport" class="btn"'));
  assert.ok(html.includes('id="btnImport" class="btn"'));
  assert.ok(css.includes(".btn-row.config-io .btn"));
  assert.ok(!/\#btnExport[^{]*\{[^}]*min-width:\s*[3-9]\d/.test(css));
  assert.ok(worker.includes("planResumeSend({ settings: config.settings, hasImages })"));
  assert.ok(worker.includes("wantAutoImage"));
  assert.ok(worker.includes("MSG.SEND_IMAGE"));
  assert.ok(content.includes("sendImageFromDataUrl"));
  assert.ok(!content.includes("sendPlatformResume"));
  assert.ok(!content.includes("BHT_SEND_RESUME"));
  assert.ok(!html.includes("autoSendAttachmentResume"));
  assert.ok(!content.includes("uploadFile("));
});

test("panel accepts agent postMessage to skip tour and start preview", () => {
  const onboarding = fs.readFileSync("extension/sidepanel/onboarding.js", "utf8");
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(onboarding.includes("source !== 'bht-agent'"));
  assert.ok(onboarding.includes("skip-onboarding"));
  assert.ok(app.includes("source !== 'bht-agent'"));
  assert.ok(app.includes("scan-preview"));
});

test("retry resumes after chat trigger without clicking the list twice", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const checkpointAt = background.indexOf("item.phase = JOB_PHASE.CHAT_TRIGGERED");
  const conversationAt = background.indexOf("MSG.WAIT_OPEN_CONVERSATION", checkpointAt);
  assert.ok(checkpointAt >= 0 && conversationAt > checkpointAt, "checkpoint must persist before conversation matching");
  assert.ok(background.includes("if (!resumedFromChat)"), "list trigger must be guarded on retry");
  assert.ok(background.includes("不会再次点击「立即沟通」"));
  assert.ok(background.includes("await chrome.tabs.reload(tabId)"), "message tab should refresh after chat creation");
  assert.ok(background.includes("item.beforeConversationKeys"), "original conversation snapshot must survive retry");
  assert.ok(background.includes("queueItem.status = 'pending'"), "retry should reopen the queue item");
  assert.ok(background.includes("counters.failed = Math.max(0"), "retry should undo the previous task failure count");
  assert.ok(content.includes("clearTimeout(innerTimeoutId)"), "completed operations must cancel their timeout timer");
  assert.ok(!content.includes("sleep(opTimeoutMs).then"), "completed operations must not emit a later false timeout");
});

await runRegisteredTests();

if (!process.exitCode) console.log("flow contract tests ok");


{
  const fs = await import("node:fs");
  const s = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(s.includes("pickNextTestDeliveryJob"));
  assert.ok(s.includes("test-delivery.js"));
  assert.ok(s.includes("testedJobIds"));
  const h = fs.readFileSync("extension/shared/test-delivery.js", "utf8");
  assert.ok(h.includes("export function pickNextTestDeliveryJob"));
  const html = fs.readFileSync("extension/sidepanel/index.html", "utf8");
  assert.ok(html.includes("投递一份"));
  assert.ok(html.includes("批量投递"));
  assert.ok(!html.includes("投递一份测试"));
  console.log("  PASS test delivery picks next untested job helper");
}
