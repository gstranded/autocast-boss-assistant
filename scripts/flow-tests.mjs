import assert from "assert";
import fs from "fs";
import { isBossUrl } from "../extension/shared/boss-url.js";
import { planMessageSegments } from "../extension/shared/message-planner.js";
import { MESSAGE_MODES } from "../extension/shared/constants.js";

console.log("8) delivery flow contracts");
function test(name, fn) {
  try { fn(); console.log("  PASS", name); }
  catch (e) { console.error("  FAIL", name, e.message); process.exitCode = 1; }
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
  assert.ok(background.includes("type === MSG.SCAN_JOBS ? 38000 : 90000"));
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

test("preview accumulates virtualized jobs and applies adaptive stop gates", () => {
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
  assert.ok(background.includes("decideAdaptiveScan"));
  assert.ok(background.includes("maxScanMs || 50000"));
  assert.ok(background.includes("maxScanJobs || 300"));
  assert.ok(background.includes("scanning_more"));
  assert.ok(panel.includes("达到投递目标、列表底部或 50 秒上限"));
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
