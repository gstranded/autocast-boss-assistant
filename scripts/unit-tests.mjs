import assert from "assert";
import { evaluateJob, summarizePreview } from "../extension/shared/filter-engine.js";
import { isSimilar, parseSalaryRange, normalizeText, parseKeywords } from "../extension/shared/text-utils.js";
import { planMessageSegments } from "../extension/shared/message-planner.js";
import { MESSAGE_MODES } from "../extension/shared/constants.js";
import { checkDedup, checkLimits, segmentIdempotencyKey, jobIdempotencyKey } from "../extension/shared/dedup.js";
import { renderTemplate, pickResumeProfile } from "../extension/shared/template.js";
import { isBossUrl, isBossHostname, isBossTab, bossUrlGuardMessage } from "../extension/shared/boss-url.js";
import { reasonText, REASON } from "../extension/shared/reason-codes.js";
import { computeSideBySideBounds } from "../extension/shared/window-layout.js";
import {
  dedupeResumeImages,
  mergeResumeImages,
  normalizeResumes
} from "../extension/shared/resume-images.js";
import "../extension/shared/conversation-match.js";
import fs from "fs";
import vm from "vm";
import { pickNextTestDeliveryJob, collectDoneJobIds } from "../extension/shared/test-delivery.js";
import {
  buildDeliveryQueue,
  countPassJobs,
  countPendingPassJobs,
  taskCounterSnapshot,
  shouldAcceptTaskSnapshot
} from "../extension/shared/task-model.js";
import { createOperationRegistry } from "../extension/background/operation-registry.js";

const {
  hasActiveState,
  cleanHrIdentity,
  stableConversationKey,
  selectConversationCandidate,
  confirmRenderedOwnMessage
} = globalThis.BHTConversationMatch;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  PASS", name);
  } catch (e) {
    console.error("  FAIL", name, "-", e.message);
    process.exitCode = 1;
  }
}

console.log("1) text-utils");
test("normalize greeting", () => {
  assert.ok(normalizeText("您好，世界").length > 0);
});
test("similar greetings", () => {
  assert.ok(isSimilar("您好，我对这个岗位很感兴趣", "你好，我对该职位很感兴趣！", 0.85));
});
test("salary parse 15-25K", () => {
  const s = parseSalaryRange("15-25K·14薪");
  assert.equal(s.min, 15000);
  assert.equal(s.max, 25000);
});
test("parseKeywords", () => {
  assert.deepEqual(parseKeywords("Java, Go，后端"), ["Java", "Go", "后端"]);
});
test("parseKeywords multi separators", () => {
  assert.deepEqual(parseKeywords("Java,Go，Spring、Redis\\Docker/K8s"), [
    "Java",
    "Go",
    "Spring",
    "Redis",
    "Docker",
    "K8s"
  ]);
  assert.deepEqual(parseKeywords("外包、驻场,销售"), ["外包", "驻场", "销售"]);
});

console.log("2) filter-engine");
const filters = {
  title: { or: ["Java", "后端"], and: ["Agent"], not: ["外包"] },
  company: { or: [], and: [], not: [] },
  jd: { or: [], and: [], not: ["驻场"] },
  location: { include: ["广州"], exclude: [], mode: "contains" },
  salaryMin: 10000,
  salaryMax: null,
  excludeHunter: true,
  excludeOutsource: true,
  activeWithin: ""
};
const passJob = {
  jobId: "1",
  title: "Java Agent 开发",
  company: "某某科技",
  jd: "负责 Agent 与后端",
  location: "广州·天河",
  salary: "15-25K"
};
test("pass matching job", () => assert.equal(evaluateJob(passJob, filters, {}, {}).decision, "pass"));
test("reject not keyword", () => assert.equal(evaluateJob({ ...passJob, title: "Java 外包开发" }, filters, {}, {}).decision, "reject"));
test("reject location", () => assert.equal(evaluateJob({ ...passJob, location: "佛山" }, filters, {}, {}).decision, "reject"));
test("blacklist company", () => {
  const r = evaluateJob(passJob, filters, { companyBlacklist: ["某某科技"] }, {});
  assert.equal(r.decision, "reject");
  assert.ok(r.reasonCodes.includes(REASON.FILTER_BLACKLIST_COMPANY));
});
test("summary counts", () => {
  const s = summarizePreview([{ decision: "pass" }, { decision: "reject", reasonCodes: ["X"] }]);
  assert.equal(s.pass, 1);
  assert.equal(s.reject, 1);
});
test("disabled OR keeps keywords but ignores the rule", () => {
  const disabled = structuredClone(filters);
  disabled.title.enabled = { or: false, and: true, not: true };
  const r = evaluateJob({ ...passJob, title: "Python Agent 开发" }, disabled, {}, {});
  assert.equal(r.decision, "pass");
});
test("disabled NOT allows a stored exclusion keyword", () => {
  const disabled = structuredClone(filters);
  disabled.title.enabled = { or: true, and: true, not: false };
  disabled.excludeOutsource = false;
  const r = evaluateJob({ ...passJob, title: "Java Agent 外包开发" }, disabled, {}, {});
  assert.equal(r.decision, "pass");
});
test("disabled location include ignores stored locations", () => {
  const disabled = structuredClone(filters);
  disabled.location.enabled = { include: false, exclude: true };
  const r = evaluateJob({ ...passJob, location: "佛山" }, disabled, {}, {});
  assert.equal(r.decision, "pass");
});

console.log("3) template + resume bind");
test("render template ok", () => {
  const rt = renderTemplate("你好{职位名称}", { title: "后端" });
  assert.ok(rt.ok);
  assert.equal(rt.text, "你好后端");
});
test("render template missing fails", () => {
  assert.equal(renderTemplate("你好{职位名称}", {}).ok, false);
});
test("pickResumeProfile priority", () => {
  const resumes = {
    defaultProfileId: "default",
    profiles: [
      { id: "default", name: "默认" },
      { id: "ai", name: "AI" },
      { id: "java", name: "Java" }
    ]
  };
  const bindings = {
    rules: [
      { priority: 1, keywords: ["Java", "Spring"], profileId: "java" },
      { priority: 0, keywords: ["LLM", "Agent"], profileId: "ai" }
    ]
  };
  assert.equal(pickResumeProfile({ title: "Java Agent", jd: "LLM" }, resumes, bindings).id, "ai");
  assert.equal(pickResumeProfile({ title: "Java 后端", jd: "Spring" }, resumes, bindings).id, "java");
  assert.equal(pickResumeProfile({ title: "产品", jd: "" }, resumes, bindings).id, "default");
});

console.log("4) message planner");
test("auto detect skips first segment", () => {
  const plan = planMessageSegments({
    mode: MESSAGE_MODES.AUTO_DETECT,
    template: {
      version: 1,
      segments: [
        { id: "1", enabled: true, text: "我对{职位名称}感兴趣" },
        { id: "2", enabled: true, text: "补充经历" }
      ]
    },
    job: { jobId: "1", bossId: "b", title: "Java" },
    recentSelfMessages: ["我对Java感兴趣"],
    threshold: 0.85,
    idempotency: {}
  });
  assert.equal(plan.startIndex, 1);
  assert.equal(plan.plan.length, 1);
});

test("resume images are deduplicated by content", () => {
  const imageA = { name: "resume.png", dataUrl: "data:image/png;base64,AAA" };
  const imageB = { name: "resume-2.png", dataUrl: "data:image/png;base64,BBB" };
  assert.deepEqual(dedupeResumeImages([imageA, { ...imageA }, imageB]), [imageA, imageB]);
  const merged = mergeResumeImages([imageA, { ...imageA }], [{ ...imageA }]);
  assert.equal(merged.images.length, 1);
  assert.equal(merged.added, 0);
  assert.equal(merged.duplicates, 2);
  const resumes = normalizeResumes({ profiles: [{ id: "default", images: [imageA, { ...imageA }] }] });
  assert.equal(resumes.profiles[0].images.length, 1);
});

console.log("5) dedup + limits");
test("task max limit", () => {
  assert.equal(
    checkLimits({
      settings: { taskMaxCommunicate: 2, dailyMaxCommunicate: 10 },
      taskSuccessCount: 2,
      todayStats: { communicate: 1 }
    }).ok,
    false
  );
});
test("session exists dedup", () => {
  assert.equal(
    checkDedup(
      { jobId: "x", bossId: "b", company: "C", title: "T", communicated: true },
      {
        settings: { neverRepeatJob: true, bossCooldownDays: 30, companyDailyMax: 3 },
        history: [],
        todayStats: { byCompany: {} },
        taskItemKeys: new Set(),
        idempotency: {}
      }
    ).ok,
    false
  );
});
test("idempotency key stable", () => {
  const k = segmentIdempotencyKey({ jobId: "j1", bossId: "b1" }, 1, 0);
  assert.ok(k.includes("j1"));
  assert.ok(jobIdempotencyKey({ jobId: "j1" }).includes("j1"));
});

console.log("6) boss-url guard");
test("boss urls accepted", () => {
  assert.equal(isBossUrl("https://www.zhipin.com/web/geek/jobs"), true);
  assert.equal(isBossUrl("https://zhipin.com/"), true);
  assert.equal(isBossUrl("https://m.zhipin.com/job"), true);
  assert.equal(isBossUrl("https://www.bosszhipin.com/"), true);
});
test("non-boss rejected", () => {
  assert.equal(isBossUrl("https://www.google.com/"), false);
  assert.equal(isBossUrl("https://notzhipin.com/"), false);
  assert.equal(isBossUrl("https://zhipin.com.evil.com/"), false);
  assert.equal(isBossUrl("chrome://extensions"), false);
  assert.equal(isBossUrl("about:blank"), false);
  assert.equal(isBossUrl(""), false);
});
test("hostname helper", () => {
  assert.equal(isBossHostname("www.zhipin.com"), true);
  assert.equal(isBossHostname("evil.com"), false);
});
test("isBossTab", () => {
  assert.equal(isBossTab({ id: 1, url: "https://www.zhipin.com/x" }), true);
  assert.equal(isBossTab({ id: 1, url: "https://baidu.com" }), false);
  assert.equal(isBossTab(null), false);
});
test("guard message non-empty", () => {
  assert.ok(bossUrlGuardMessage("https://baidu.com").length > 5);
  assert.ok(reasonText(REASON.DEDUP_JOB).length > 0);
});

console.log("7) assets");
test("logo png valid", () => {
  const b = fs.readFileSync("docs/assets/logo.png");
  assert.equal(b[0], 0x89);
  assert.equal(b[1], 0x50);
  assert.equal(b[2], 0x4e);
  assert.equal(b[3], 0x47);
  assert.ok(b.length > 1000);
});
test("logo svg exists", () => {
  const s = fs.readFileSync("docs/assets/logo.svg", "utf8");
  assert.ok(s.includes("<svg"));
  assert.ok(s.includes("#3B82F6"));
});
test("screenshots valid png", () => {
  for (const f of ["01-task", "02-filter", "03-message", "04-resume", "05-settings"]) {
    const b = fs.readFileSync(`docs/assets/screenshots/${f}.png`);
    assert.equal(b[0], 0x89);
    assert.equal(b[1], 0x50);
  }
});
test("manifest version + hosts", () => {
  const m = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(m.version, pkg.version);
  assert.ok(m.host_permissions.some((h) => h.includes("zhipin.com")));
  assert.ok(m.content_scripts[0].matches.every((h) => h.includes("zhipin.com") || h.includes("bosszhipin.com")));
  assert.equal(m.content_scripts[0].js[0], "shared/conversation-match.js");
});
test("UI exposes themes, help tips and filter switches", () => {
  const html = fs.readFileSync("extension/sidepanel/index.html", "utf8");
  assert.ok(html.includes('data-theme-value="light"'));
  assert.ok(html.includes('data-theme-value="dark"'));
  assert.ok((html.match(/data-help=/g) || []).length >= 25);
  for (const id of [
    "titleOrEnabled",
    "titleAndEnabled",
    "titleNotEnabled",
    "companyOrEnabled",
    "companyNotEnabled",
    "jdOrEnabled",
    "jdAndEnabled",
    "jdNotEnabled",
    "locIncludeEnabled",
    "locExcludeEnabled"
  ]) assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
});
test("resume files are only imported by an explicit save", () => {
  const sidepanel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(sidepanel.includes("includePendingFiles: false"));
  assert.ok(sidepanel.includes("String(target.type || '').toLowerCase() !== 'file'"));
  assert.ok(sidepanel.includes("resumeSaveChain.then"));
  assert.ok(sidepanel.includes("const shouldRefresh = opts.refresh !== false"));
  assert.ok(!sidepanel.includes("const refresh = opts.refresh !== false"));
  assert.ok(background.includes("dedupeResumeImages(profile?.images)"));
});
test("side-by-side layout fills the available display", () => {
  const layout = computeSideBySideBounds({ left: 0, top: 24, width: 1920, height: 1056 });
  assert.deepEqual(layout.left, { left: 0, top: 24, width: 960, height: 1056 });
  assert.deepEqual(layout.right, { left: 960, top: 24, width: 960, height: 1056 });
  assert.equal(computeSideBySideBounds({ left: 0, top: 0, width: 900, height: 800 }), null);
});
test("task start prepares split workspace with fallback", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(background.includes("prepareSplitWorkspace"));
  assert.ok(background.includes("computeSideBySideBounds"));
  assert.ok(background.includes("splitViewActive"));
  assert.ok(background.includes("普通消息标签页"));
});
test("floating controls stay fully visible after a split-window resize", () => {
  const source = fs.readFileSync("extension/content/floating-host.js", "utf8");
  let domLookups = 0;
  const context = {
    window: { location: { href: "https://www.zhipin.com/web/geek/chat" } },
    document: {
      readyState: "complete",
      addEventListener() {},
      getElementById() {
        domLookups++;
        return null;
      }
    },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    setInterval() {},
    setTimeout() {},
    cancelAnimationFrame() {},
    requestAnimationFrame() { return 1; }
  };
  vm.runInNewContext(source, context);
  const fit = context.window.__BHT_FLOAT_LAYOUT__.fitRectToViewport;
  const isMessagePage = context.window.__BHT_FLOAT_LAYOUT__.isMessagePage;
  const panel = fit(
    { left: 1400, top: 100, width: 420, height: 700 },
    { width: 960, height: 900 },
    8
  );
  const fab = fit(
    { left: 1800, top: 1000, width: 58, height: 58 },
    { width: 960, height: 900 },
    0
  );
  assert.equal(panel.left, 532);
  assert.equal(panel.top, 100);
  assert.equal(fab.left, 902);
  assert.equal(fab.top, 842);
  assert.equal(isMessagePage("https://www.zhipin.com/web/geek/chat"), true);
  assert.equal(isMessagePage("https://www.zhipin.com/web/geek/jobs"), false);
  assert.equal(domLookups, 0, "message pages must not mount the floating host");
  assert.ok(source.includes('window.addEventListener("resize", schedule)'));
  assert.ok(source.includes('root.style.display = "none"'));
  assert.ok(!source.includes("window.innerWidth - 80"));
});

console.log("8) conversation selection + delivery receipt");
test("friend-content is not mistaken for active", () => {
  assert.equal(hasActiveState("friend-content", ""), false);
  assert.equal(hasActiveState("friend-content active", ""), true);
  assert.equal(hasActiveState("friend-content", "true"), true);
});
test("stable conversation key ignores changing preview text", () => {
  const a = stableConversationKey({
    identityText: "王女士|示例科技|Java 开发",
    text: "王女士\n示例科技\nJava 开发\n10:21\n您好"
  });
  const b = stableConversationKey({
    identityText: "王女士|示例科技|Java 开发",
    text: "王女士\n示例科技\nJava 开发\n10:28\n收到简历"
  });
  assert.equal(a, b);
});
test("HR activity suffix is removed before conversation matching", () => {
  assert.equal(cleanHrIdentity("范女士 在线"), "范女士");
  assert.equal(cleanHrIdentity("赵舒雅 本周活跃"), "赵舒雅");
  assert.equal(cleanHrIdentity("李响 · 刚刚活跃"), "李响");
});
test("select exact company and title conversation", () => {
  const picked = selectConversationCandidate([
    { index: 0, key: "a", text: "李女士 其他科技 Java 开发" },
    { index: 1, key: "b", text: "王女士 示例科技 Java 开发" }
  ], {
    company: "示例科技",
    title: "Java 开发",
    hrName: "王女士"
  }, ["a", "b"]);
  assert.equal(picked.ok, true);
  assert.equal(picked.item.key, "b");
});
test("select the only newly-created conversation", () => {
  const picked = selectConversationCandidate([
    { index: 0, key: "new", text: "赵先生 新会话" },
    { index: 1, key: "old", text: "历史会话" }
  ], { company: "", title: "" }, ["old"]);
  assert.equal(picked.ok, true);
  assert.equal(picked.item.key, "new");
  assert.equal(picked.via, "new-single");
});
test("ambiguous conversations stop instead of guessing", () => {
  const picked = selectConversationCandidate([
    { index: 0, key: "a", text: "示例科技 Java 工程师" },
    { index: 1, key: "b", text: "示例科技 Java 工程师" }
  ], { company: "示例科技", title: "Java 工程师" }, ["a", "b"]);
  assert.equal(picked.ok, false);
  assert.equal(picked.error, "CONVERSATION_AMBIGUOUS");
});
test("input clearing alone cannot confirm a send", () => {
  assert.equal(
    confirmRenderedOwnMessage(["历史消息"], ["历史消息"], "新的测试消息"),
    false
  );
});
test("new rendered own message confirms a send", () => {
  assert.equal(
    confirmRenderedOwnMessage(["历史消息"], ["历史消息", "新的测试消息"], "新的测试消息"),
    true
  );
});
test("content script requires rendered own-message receipt", () => {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const sidepanel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const messaging = fs.readFileSync("extension/shared/messaging.js", "utf8");
  assert.ok(content.includes(".friend-content"));
  assert.ok(content.includes('".name-box"'));
  assert.ok(content.includes('confirmedVia: "self-message-dom"'));
  assert.ok(content.includes("sendPlatformResume"));
  assert.ok(content.includes('type: "RESUME_SENT"'));
  assert.ok(!content.includes("输入框被清空也视为已发送"));
  assert.ok(background.includes("receiptConfirmed"));
  assert.ok(background.includes("TASK_COMPLETED"));
  assert.ok(background.includes("TASK_STOPPED"));
  assert.ok(background.includes("成功投递"));
  assert.ok(background.includes("MSG.SEND_RESUME"));
  assert.ok(!background.includes("profile.attachment.dataUrl"));
  assert.ok(sidepanel.includes("MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024"));
  assert.ok(messaging.includes("BHT_SEND_RESUME"));
});


console.log("8b) delivery control & image receipt contracts");
test("image send requires confirmed IMAGE_SENT receipt", () => {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(content.includes("waitForImageSendConfirm"));
  assert.ok(content.includes("IMAGE_SEND_NOT_CONFIRMED"));
  assert.ok(content.includes('type: "IMAGE_SENT"'));
  assert.ok(background.includes("imgRes?.receipt?.type === 'IMAGE_SENT'"));
  assert.ok(background.includes("return 'failed'"));
  assert.ok(background.includes("图片简历发送失败"));
});

test("skip while paused does not leave skipCurrent sticky", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(background.includes("runner.skipCurrent = false"));
  assert.ok(background.includes("已跳过当前岗位，继续下一岗"));
  // paused skip path clears flag before resuming loop
  assert.ok(background.includes("若在等待用户重试的暂停中：直接标记当前岗位跳过"));
});

test("resume stage rechecks pause/abort/skip controls", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(background.includes("resume: re-check controls after last text segment"));
  assert.ok(background.includes("await waitWhilePaused(task);"));
});

test("template version only bumps when message content changes", () => {
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(app.includes("templateSegmentsSignature"));
  assert.ok(app.includes("shouldBump = opts.bumpVersion !== false && changed"));
  assert.ok(app.includes("readTemplate(prevTemplate, { bumpVersion: false })"));
  assert.ok(app.includes("ensureConfigSavedBeforeDelivery"));
});

test("start/test delivery refuses ALREADY_RUNNING and requires pre-save", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(background.includes("error: 'ALREADY_RUNNING'"));
  assert.ok(background.includes("withRunnerAdmission('starting'"));
  assert.ok(background.includes("runner.previewing"));
  assert.ok(app.includes("await ensureConfigSavedBeforeDelivery()"));
  assert.ok(!app.includes("try { await saveSettings(); await saveResume(); await saveMessage(); } catch (_) {}"));
});

test("service worker reconciles stale running tasks after restart", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(background.includes("async function reconcileStaleRunningTask"));
  assert.ok(background.includes("chrome.runtime.onStartup"));
  assert.ok(background.includes("任务已安全暂停"));
});

test("preview scan uses try/finally to restore button", () => {
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const start = app.indexOf("$('btnPreview').addEventListener('click'");
  assert.ok(start > 0);
  const chunk = app.slice(start, start + 1200);
  assert.ok(chunk.includes("try {"));
  assert.ok(chunk.includes("} finally {"));
  assert.ok(chunk.includes("$('btnPreview').disabled = false"));
});

test("debug logging is session-only, toggleable and exportable", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const html = fs.readFileSync("extension/sidepanel/index.html", "utf8");
  const debugLog = fs.readFileSync("extension/shared/debug-log.js", "utf8");
  assert.ok(debugLog.includes("chrome.storage.session"));
  assert.ok(background.includes("case MSG.GET_DEBUG_LOGS"));
  assert.ok(content.includes("conversation_selection"));
  assert.ok(content.includes("conversation_switch_probe"));
  assert.ok(app.includes("btnExportDebugLogs"));
  assert.ok(html.includes('id="debugLoggingEnabled"'));
});

test("conversation opener never repeatedly clicks the same candidate", () => {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const start = content.indexOf("async function waitAndOpenConversation");
  const end = content.indexOf("async function waitChatEditor", start);
  const chunk = content.slice(start, end);
  assert.ok(chunk.includes("const attemptedKeys = new Set()"));
  assert.ok(chunk.includes("conversation_candidate_already_clicked"));
  assert.ok(!/i === 3[\s\S]{0,250}clickLikeHuman/.test(chunk));
});

console.log("9) split workspace integration");
try {
  const listTab = {
    id: 10,
    windowId: 1,
    url: "https://www.zhipin.com/web/geek/jobs",
    status: "complete"
  };
  const messageTab = {
    id: 20,
    windowId: 2,
    url: "https://www.zhipin.com/web/geek/chat",
    status: "complete"
  };
  const windowCalls = [];
  let displayWidth = 1920;
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      sendMessage() { return Promise.resolve({ ok: true }); }
    },
    action: { onClicked: { addListener() {} } },
    tabs: {
      onUpdated: { addListener() {} },
      onActivated: { addListener() {} },
      async query(query) {
        if (query?.active) return [listTab];
        if (query?.url) return [listTab];
        if (query?.windowId === 2) return [messageTab];
        return [];
      },
      async get(tabId) {
        if (tabId === listTab.id) return listTab;
        if (tabId === messageTab.id) return messageTab;
        throw new Error("unknown tab " + tabId);
      },
      async update(tabId, patch) {
        windowCalls.push({ api: "tabs.update", tabId, patch });
        return tabId === messageTab.id ? { ...messageTab, ...patch } : { ...listTab, ...patch };
      },
      async setZoomSettings(tabId, settings) {
        windowCalls.push({ api: "tabs.setZoomSettings", tabId, settings });
      },
      async setZoom(tabId, zoomFactor) {
        windowCalls.push({ api: "tabs.setZoom", tabId, zoomFactor });
      }
    },
    scripting: {
      async executeScript(options) {
        if (options?.func) {
          return [{ result: { left: 0, top: 24, width: displayWidth, height: 1056 } }];
        }
        windowCalls.push({ api: "scripting.executeScript", tabId: options?.target?.tabId });
        return [];
      }
    },
    windows: {
      async get(windowId) {
        return { id: windowId, left: 80, top: 60, width: 1280, height: 900, tabs: [] };
      },
      async update(windowId, patch) {
        windowCalls.push({ api: "windows.update", windowId, patch });
        return { id: windowId, ...patch };
      },
      async create(options) {
        windowCalls.push({ api: "windows.create", options });
        return { id: 2, tabs: [messageTab] };
      }
    }
  };

  const { prepareSplitWorkspace } = await import("../extension/background/service-worker.js");
  const task = { execution: { listTabId: listTab.id, listWindowId: listTab.windowId } };
  const split = await prepareSplitWorkspace(task, { splitViewEnabled: true });
  assert.equal(split.ok, true);
  assert.equal(task.execution.splitViewActive, true);
  assert.equal(task.execution.messageTabId, messageTab.id);
  assert.deepEqual(split.bounds.left, { left: 0, top: 24, width: 960, height: 1056 });
  assert.deepEqual(split.bounds.right, { left: 960, top: 24, width: 960, height: 1056 });
  assert.equal(split.zoomFactor, 0.8);
  assert.equal(split.zoomApplied, true);
  assert.equal(task.execution.splitZoomFactor, 0.8);
  assert.deepEqual(
    windowCalls.filter((call) => call.api === "tabs.setZoom").map((call) => [call.tabId, call.zoomFactor]),
    [[listTab.id, 0.8], [messageTab.id, 0.8]]
  );
  assert.ok(windowCalls
    .filter((call) => call.api === "tabs.setZoomSettings")
    .every((call) => call.settings.mode === "automatic" && call.settings.scope === "per-tab"));
  assert.ok(windowCalls.some((call) => call.api === "windows.create" && call.options.left === 960));
  assert.ok(windowCalls.some((call) => call.api === "windows.update" && call.windowId === 1 && call.patch.width === 960));
  assert.ok(windowCalls.some((call) => call.api === "windows.update" && call.windowId === 1 && call.patch.focused === true));

  const createsBeforeFallback = windowCalls.filter((call) => call.api === "windows.create").length;
  displayWidth = 900;
  const fallbackTask = { execution: { listTabId: listTab.id, listWindowId: listTab.windowId } };
  const fallback = await prepareSplitWorkspace(fallbackTask, { splitViewEnabled: true });
  assert.equal(fallback.ok, false);
  assert.equal(fallback.error, "DISPLAY_TOO_SMALL");
  assert.equal(fallbackTask.execution.splitViewActive, false);
  assert.equal(windowCalls.filter((call) => call.api === "windows.create").length, createsBeforeFallback);
  passed++;
  console.log("  PASS browser windows split and narrow-display fallback");
} catch (e) {
  console.error("  FAIL browser windows split and narrow-display fallback -", e.message);
  process.exitCode = 1;
}


console.log("11a) preview reason wording");
test("preview reason count wording", () => {
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(app.includes("formatPreviewReasonLine"), "has formatPreviewReasonLine");
  assert.ok(app.includes("被排除岗位数"), "explains count is job count");
  assert.ok(app.includes("生效设置"), "shows effective settings snapshot");
  assert.ok(app.includes("companyDailyMax"), "mentions companyDailyMax in preview");
});

console.log("11b) batch button after single delivery");
test("batch delivery not limited to awaiting_confirm", () => {
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  assert.ok(app.includes("canBatch"), "updateTaskUI should compute canBatch");
  assert.ok(app.includes("还剩") || app.includes("未投"), "status should mention remaining jobs");
  assert.ok(app.includes("is-armed"), "control buttons use armed highlight");
  assert.ok(!/btnStart'\)\.disabled = !\(onBoss && status === 'awaiting_confirm'\)/.test(app), "old awaiting_confirm-only gate must be gone");
  const sw = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(sw.includes("NO_PENDING") || sw.includes("没有可批量投递"), "CONFIRM_AND_START handles empty pending");
  assert.ok(sw.includes("批量投递启动"), "batch start log present");
  assert.ok(sw.includes("自动勾选剩余未投通过岗") || sw.includes("testDelivery"), "restore selection after single delivery");
});

console.log("12) test-delivery next job");
const sampleResults = [
  { decision: "pass", selected: true, job: { jobId: "a", title: "岗A", company: "公司A" } },
  { decision: "pass", selected: true, job: { jobId: "b", title: "岗B", company: "公司B" } },
  { decision: "pass", selected: false, job: { jobId: "c", title: "岗C", company: "公司C" } },
  { decision: "reject", job: { jobId: "d", title: "岗D", company: "公司D" } }
];

test("first click picks first pass", () => {
  const r = pickNextTestDeliveryJob({ results: sampleResults });
  assert.equal(r.ok, true);
  assert.equal(r.onlyId, "a");
  assert.equal(r.remain, 2);
});

test("second click after a completed picks b", () => {
  const r = pickNextTestDeliveryJob({
    results: sampleResults,
    items: [{ jobId: "a", state: "COMPLETED" }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.onlyId, "b");
  assert.equal(r.remain, 1);
});

test("wantId ignores already done and falls through", () => {
  const r = pickNextTestDeliveryJob({
    results: sampleResults,
    items: [{ jobId: "a", state: "COMPLETED" }],
    wantId: "a"
  });
  assert.equal(r.ok, true);
  assert.equal(r.onlyId, "b");
});

test("extraDoneIds / testedJobIds advances even if queue wiped", () => {
  const r = pickNextTestDeliveryJob({
    results: sampleResults,
    queue: [{ jobId: "b", status: "pending" }],
    extraDoneIds: ["a"]
  });
  assert.equal(r.ok, true);
  assert.equal(r.onlyId, "b");
});

test("all tested returns ALL_TESTED", () => {
  const r = pickNextTestDeliveryJob({
    results: sampleResults,
    items: [
      { jobId: "a", state: "COMPLETED" },
      { jobId: "b", state: "SKIPPED" },
      { jobId: "c", state: "COMPLETED" }
    ]
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "ALL_TESTED");
});

test("collectDoneJobIds merges items queue and extra", () => {
  const s = collectDoneJobIds(
    [{ jobId: "x", state: "COMPLETED" }],
    [{ jobId: "y", status: "skipped" }],
    ["z"]
  );
  assert.ok(s.has("x") && s.has("y") && s.has("z"));
});

console.log("13) task model + cancellation contract");
test("shared task model owns queue dedupe and pending counts", () => {
  const task = {
    results: [
      { decision: "pass", selected: true, job: { jobId: "a", title: "Java", company: "A" } },
      { decision: "pass", selected: true, job: { jobId: "a", title: "Java", company: "A" } },
      { decision: "pass", selected: true, job: { jobId: "b", title: "Go", company: "B" } },
      { decision: "reject", job: { jobId: "c", title: "Sales", company: "C" } }
    ],
    items: [{ jobId: "a", state: "COMPLETED" }],
    queue: [],
    testedJobIds: [],
    counters: { success: 1, skipped: 2, failed: 3, processed: 6 }
  };
  assert.equal(buildDeliveryQueue(task.results).length, 2);
  assert.equal(countPassJobs(task), 3);
  assert.equal(countPendingPassJobs(task), 1);
  assert.deepEqual(taskCounterSnapshot(task), { success: 1, skipped: 2, failed: 3, processed: 6 });
});

test("operation registry returns and clears every active content operation", () => {
  const registry = createOperationRegistry();
  registry.add({ opId: "one", tabId: 1 });
  registry.add({ opId: "two", tabId: 2 });
  assert.equal(registry.size, 2);
  assert.deepEqual(registry.list().map((row) => row.opId), ["one", "two"]);
  const cancelled = registry.clear();
  assert.equal(cancelled.length, 2);
  assert.equal(registry.size, 0);
});

test("older polling snapshots cannot overwrite a stopped task event", () => {
  const stopped = { id: "task-1", revision: 8, updatedAt: 200, status: "stopped", createdAt: 100 };
  const staleRunning = { id: "task-1", revision: 7, updatedAt: 190, status: "running", createdAt: 100 };
  const restarted = { id: "task-1", revision: 9, updatedAt: 210, status: "running", createdAt: 100 };
  assert.equal(shouldAcceptTaskSnapshot(stopped, staleRunning), false);
  assert.equal(shouldAcceptTaskSnapshot(stopped, restarted), true);
  assert.equal(shouldAcceptTaskSnapshot(staleRunning, stopped), true);
});

test("stop cancels page operations and protects the stopped terminal state", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const messaging = fs.readFileSync("extension/shared/messaging.js", "utf8");
  const stop = background.slice(background.indexOf("case MSG.STOP_TASK"), background.indexOf("case MSG.SKIP_CURRENT"));
  assert.ok(stop.includes("runner.abort = true"));
  assert.ok(stop.includes("await cancelActiveOperations"));
  assert.ok(background.includes("STOP 是不可逆终态"));
  assert.ok(background.includes("row?.status === 'cancelled'"));
  assert.ok(content.includes("operationCancelledError"));
  assert.ok(content.includes("BHT_OP_CANCELLED"));
  assert.ok(content.includes('status: "cancelled"'));
  assert.ok(!content.includes("resumePendingOps"));
  assert.ok(!background.includes("tabs.connect"));
  assert.ok(!content.includes("runtime.onConnect"));
  assert.ok(background.includes("clearStaleOperationArtifacts"));
  assert.ok(messaging.includes("BHT_CANCEL_OP"));
});

test("legacy worker-tab delivery path has been removed", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  assert.ok(!background.includes("function ensureWorkerTab"));
  assert.ok(!background.includes("function openQueueJobOnWorker"));
  assert.ok(background.includes("buildDeliveryQueue"));
  assert.ok(background.includes("collectDoneJobIds"));
});


if (process.exitCode) {
  console.error("\nSome tests failed");
  process.exit(1);
}
console.log(`\nAll ${passed} unit tests passed.`);
