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
  assert.ok(background.includes("if (trig.navigated)"));
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

test("history filter export clear and platform resume stay on shipped paths", () => {
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
  assert.ok(worker.includes("wantPlatformResume"));
  assert.ok(content.includes("sendPlatformResume"));
  assert.ok(content.includes("发简历"));
  assert.ok(content.includes("BHT_SEND_RESUME") || content.includes("SEND_RESUME"));
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
