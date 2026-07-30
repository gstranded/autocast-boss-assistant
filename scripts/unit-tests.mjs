import assert from "assert";
import { evaluateJob, summarizePreview } from "../extension/shared/filter-engine.js";
import { isSimilar, parseSalaryRange, normalizeText, parseKeywords } from "../extension/shared/text-utils.js";
import { planMessageSegments } from "../extension/shared/message-planner.js";
import { MESSAGE_MODES } from "../extension/shared/constants.js";
import { checkDedup, checkLimits, segmentIdempotencyKey, jobIdempotencyKey } from "../extension/shared/dedup.js";
import { renderTemplate, pickResumeProfile } from "../extension/shared/template.js";
import { isBossUrl, isBossHostname, isBossTab, bossUrlGuardMessage } from "../extension/shared/boss-url.js";
import { reasonText, REASON } from "../extension/shared/reason-codes.js";
import "../extension/shared/conversation-match.js";
import fs from "fs";

const {
  hasActiveState,
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
  assert.equal(m.version, "1.5.4");
  assert.ok(m.host_permissions.some((h) => h.includes("zhipin.com")));
  assert.ok(m.content_scripts[0].matches.every((h) => h.includes("zhipin.com") || h.includes("bosszhipin.com")));
  assert.equal(m.content_scripts[0].js[0], "shared/conversation-match.js");
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

if (process.exitCode) {
  console.error("\nSome tests failed");
  process.exit(1);
}
console.log(`\nAll ${passed} unit tests passed.`);
