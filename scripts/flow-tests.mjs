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

function extractFunctionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing function marker: ${startMarker}`);
  assert.ok(end > start, `missing function boundary: ${endMarker}`);
  return source.slice(start, end).trim();
}

function createVirtualScanHarness({
  totalJobs = 12,
  visibleJobs = 3,
  initialTop = 0,
  replaceScrollerAfterSleeps = 0,
  initialLoadedJobs = totalJobs,
  appendBatchSize = 0,
  cancelAfterSleeps = 0
} = {}) {
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const functionSource = extractFunctionSource(
    content,
    "async function scanAdaptiveJobBatch",
    "async function fetchJobActivityDetail"
  );
  const itemHeight = 100;
  const viewport = visibleJobs * itemHeight;
  let loadedJobs = appendBatchSize > 0
    ? Math.max(1, Math.min(totalJobs, initialLoadedJobs))
    : totalJobs;
  const currentHeight = () => loadedJobs * itemHeight;
  const assignments = [];
  const collections = [];
  const events = [];
  let clock = 0;
  let sleepCount = 0;
  let scrollerGeneration = 1;

  function makeScroller(top, generation) {
    let scrollTop = Math.max(0, Math.min(currentHeight() - viewport, top));
    const scroller = {
      isConnected: true,
      tagName: "DIV",
      id: `virtual-scroller-${generation}`,
      className: "virtual-job-list",
      clientHeight: viewport,
      get scrollHeight() { return currentHeight(); },
      get scrollTop() { return scrollTop; },
      set scrollTop(next) {
        scrollTop = Math.max(0, Math.min(currentHeight() - viewport, Number(next) || 0));
        assignments.push({ generation, requested: Number(next) || 0, actual: scrollTop });
        events.push({ type: "scroll", generation, top: scrollTop });
      }
    };
    return scroller;
  }

  let activeScroller = makeScroller(initialTop, scrollerGeneration);
  const documentElement = { get scrollHeight() { return currentHeight(); } };
  const body = { get scrollHeight() { return currentHeight(); } };
  const document = { scrollingElement: documentElement, documentElement, body };
  const window = {
    __BHT_SCAN_SESSION__: null,
    innerHeight: viewport,
    scrollY: 0,
    scrollTo(_x, top) { this.scrollY = Number(top) || 0; }
  };
  const scrollHelperSource = extractFunctionSource(
    content,
    "function setAdaptiveScrollTop",
    "function collectAdaptiveScanJobs"
  );
  const scrollHelpers = new Function(
    "window",
    "document",
    `${scrollHelperSource}; return { setAdaptiveScrollTop, nextAdaptiveScrollTop, pulseAdaptiveScrollBottom, hasExplicitJobListEnd };`
  )(window, document);

  function adaptiveScrollSnapshot(scroller) {
    const top = Number(scroller.scrollTop || 0);
    return {
      top,
      viewport: scroller.clientHeight,
      height: scroller.scrollHeight,
      atBottom: top + scroller.clientHeight >= scroller.scrollHeight - 48
    };
  }

  function collectAdaptiveScanJobs(session) {
    const firstIndex = Math.max(0, Math.floor(activeScroller.scrollTop / itemHeight));
    const firstRenderedIndex = appendBatchSize > 0 ? 0 : firstIndex;
    const renderedCount = appendBatchSize > 0
      ? loadedJobs
      : Math.min(visibleJobs, totalJobs - firstIndex);
    const visible = Array.from(
      { length: renderedCount },
      (_, offset) => ({
        jobId: `job-${firstRenderedIndex + offset}`,
        title: `Job ${firstRenderedIndex + offset}`,
        company: "Virtual Co"
      })
    );
    collections.push({
      generation: scrollerGeneration,
      top: activeScroller.scrollTop,
      ids: visible.map((job) => job.jobId)
    });
    events.push({ type: "collect", generation: scrollerGeneration, top: activeScroller.scrollTop });
    const newJobs = [];
    for (const job of visible) {
      if (!session.jobs.has(job.jobId)) newJobs.push(job);
      session.jobs.set(job.jobId, job);
    }
    return {
      added: newJobs.length,
      newJobs,
      visibleCount: visible.length,
      signature: visible.map((job) => job.jobId).join("|")
    };
  }

  const sleep = async (ms) => {
    clock += Math.max(0, Number(ms) || 0);
    sleepCount += 1;
    const wasAtBottom = activeScroller.scrollTop + viewport >= activeScroller.scrollHeight - 48;
    if (appendBatchSize > 0 && wasAtBottom && loadedJobs < totalJobs) {
      loadedJobs = Math.min(totalJobs, loadedJobs + appendBatchSize);
      events.push({ type: "load", at: clock, loadedJobs });
    }
    if (replaceScrollerAfterSleeps > 0 && sleepCount === replaceScrollerAfterSleeps) {
      const previous = activeScroller;
      previous.isConnected = false;
      scrollerGeneration += 1;
      activeScroller = makeScroller(previous.scrollTop, scrollerGeneration);
    }
    if (cancelAfterSleeps > 0 && sleepCount === cancelAfterSleeps) {
      const error = new Error("任务已停止，页面操作已取消");
      error.code = "OP_CANCELLED";
      throw error;
    }
  };
  const getAdaptiveScanScroller = () => activeScroller;
  const describeAdaptiveScanScroller = (scroller) => ({
    kind: "element",
    tag: scroller.tagName,
    id: scroller.id,
    className: scroller.className,
    overflowY: "auto"
  });
  const normalizeText = (value) => String(value || "").toLowerCase();
  const FakeDate = { now: () => clock };
  const scanAdaptiveJobBatch = new Function(
    "window",
    "document",
    "getAdaptiveScanScroller",
    "describeAdaptiveScanScroller",
    "adaptiveScrollSnapshot",
    "collectAdaptiveScanJobs",
    "normalizeText",
    "sleep",
    "Date",
    "setAdaptiveScrollTop",
    "nextAdaptiveScrollTop",
    "pulseAdaptiveScrollBottom",
    "hasExplicitJobListEnd",
    `return (${functionSource});`
  )(
    window,
    document,
    getAdaptiveScanScroller,
    describeAdaptiveScanScroller,
    adaptiveScrollSnapshot,
    collectAdaptiveScanJobs,
    normalizeText,
    sleep,
    FakeDate,
    scrollHelpers.setAdaptiveScrollTop,
    scrollHelpers.nextAdaptiveScrollTop,
    scrollHelpers.pulseAdaptiveScrollBottom,
    scrollHelpers.hasExplicitJobListEnd
  );

  return {
    scanAdaptiveJobBatch,
    assignments,
    collections,
    events,
    get activeScroller() { return activeScroller; },
    get sleepCount() { return sleepCount; },
    get clock() { return clock; },
    get loadedJobs() { return loadedJobs; }
  };
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
  assert.ok(panel.includes("正在扫描岗位"));
  assert.ok(!panel.includes("下方暂时仍是上一次预览"));
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

test("HR activity is inspected on the temporary detail before any conversation click", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const messaging = fs.readFileSync("extension/shared/messaging.js", "utf8");
  const worker = extractFunctionSource(
    background,
    "async function triggerConversationInWorker",
    "async function sendToBoss"
  );
  const inspectAt = worker.indexOf("MSG.INSPECT_JOB_DETAIL");
  const triggerAt = worker.indexOf("MSG.TRIGGER_CONVERSATION");
  assert.ok(inspectAt >= 0 && triggerAt > inspectAt);
  assert.ok(worker.includes("matchActive(activeText, selectedActiveBuckets)"));
  assert.ok(worker.includes("if (!result)"));
  assert.ok(worker.includes("filtered: true"));
  assert.ok(worker.includes("result?.filtered"));
  assert.ok(background.includes("{ deferUnknownActive: true }"));
  assert.ok(background.includes("requiresActiveCheck: decision === 'pass' && requiresActiveCheck"));
  assert.ok(background.includes("finalizePreviewActivityDecisions"));
  assert.ok(content.includes("async function inspectWorkerJobDetail"));
  assert.ok(content.includes("extractDetailActiveText"));
  assert.ok(content.includes('case MSG.INSPECT_JOB_DETAIL'));
  assert.ok(messaging.includes("INSPECT_JOB_DETAIL: 'BHT_INSPECT_JOB_DETAIL'"));
});

test("preview captures native job metadata and bounds read-only HR activity enrichment", () => {
  const hook = fs.readFileSync("extension/content/page-network-hook.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const messaging = fs.readFileSync("extension/shared/messaging.js", "utf8");
  assert.ok(hook.includes("/wapi\\/zpgeek\\/(?:search\\/joblist|pc\\/recommend\\/job\\/list"));
  assert.ok(hook.includes("/wapi\\/zpgeek\\/job\\/detail"));
  assert.ok(hook.includes("securityId"));
  assert.ok(hook.includes("lid"));
  assert.ok(hook.includes("bossOnline"));
  assert.ok(hook.includes("activeTimeDesc"));
  assert.ok(hook.includes("job-metadata-request"));
  assert.ok(content.includes("extractJobMetadataFromComponent"));
  assert.ok(content.includes("inspectListSideDetail"));
  assert.ok(content.includes("extractDetailHunter"));
  assert.ok(content.includes("source: \"preview-no-click\""));
  assert.ok(background.includes("applyPreviewActivityEnrichment"));
  assert.ok(background.includes("finalizePreviewActivityDecisions"));
  assert.ok(background.includes("deferredToDelivery"));
  assert.ok(!background.includes("activityCandidates.slice(0, 80)"));
  assert.ok(content.includes("parseBossActiveLabel"));
  assert.ok(content.includes(".boss-online-tag"));
  const html = fs.readFileSync("extension/sidepanel/index.html", "utf8");
  assert.ok(html.includes('data-active="half"'));
  assert.ok(html.includes(">半年内<"));
  assert.ok(html.includes(">单选<"));
  assert.ok(!html.includes("3日前活跃"));
  assert.ok(messaging.includes("ENRICH_JOB_ACTIVITY: 'BHT_ENRICH_JOB_ACTIVITY'"));
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
  const timeouts = fs.readFileSync("extension/shared/operation-timeouts.js", "utf8");
  assert.ok(content.includes("scanAdaptiveJobBatch"));
  assert.ok(content.includes("window.__BHT_SCAN_SESSION__"));
  assert.ok(content.includes("session.jobs = new Map") || content.includes("jobs: new Map()"));
  assert.ok(content.includes("visibleChanged"));
  assert.ok(content.includes("bottomStableRounds"));
  assert.ok(content.includes("lastGrowthAt"));
  assert.ok(content.includes("pulseAdaptiveScrollBottom"));
  assert.ok(content.includes("nextAdaptiveScrollTop"));
  assert.ok(content.includes("setAdaptiveScrollTop(scroller, nextAdaptiveScrollTop(before))"));
  assert.ok(content.includes("deadlineAt"));
  assert.ok(content.includes("timedOut"));
  assert.ok(content.includes("Math.floor(viewport * 0.85)"));
  assert.ok(content.includes("Number.isFinite(requestedWaitMs) ? requestedWaitMs : 100"));
  assert.ok(content.includes("payload.deltaOnly === true"));
  assert.ok(content.includes("returnedCount"));
  assert.ok(content.includes("payload.continuous === true"));
  assert.ok(content.includes("collectionFinishedAt"));
  assert.ok(content.includes("workCompletedAt"));
  assert.ok(content.includes("session.cardCache"));
  assert.ok(content.includes("puaDigitCache"));
  assert.ok(content.includes("continuingSession"));
  assert.ok(content.includes("sleepUntilScanStop"));
  assert.ok(content.includes("isScanStopError"));
  assert.ok(content.includes("opType === MSG.SCAN_JOBS"));
  assert.ok(content.includes("lateResult.jobs.length"));
  assert.ok(background.includes("scanDeadlinePartial"));
  assert.ok(background.includes("continuous: true"));
  const continuationStart = content.indexOf("const continuingSession =");
  const continuationEnd = content.indexOf("const ensured = continuingSession", continuationStart);
  const continuationGuard = content.slice(continuationStart, continuationEnd);
  assert.ok(continuationGuard.includes("isListLikePage()"));
  assert.ok(!continuationGuard.includes("jobs?.size > 0"));
  assert.ok(!continuationGuard.includes("getJobCards().length"));
  assert.ok(content.includes("只按 pathname 判断"));
  assert.ok(content.includes("collected.visibleCount > 0"));
  assert.ok(background.includes("const requestedMaxScanMs = Number(payload.maxScanMs)"));
  assert.ok(background.includes("Number.isFinite(requestedMaxScanMs) && requestedMaxScanMs > 0"));
  assert.ok(background.includes("Math.min(OPERATION_TIMEOUTS.PREVIEW_SCROLL_MS, requestedMaxScanMs)"));
  assert.ok(background.includes("mergePreviewJobBatch"));
  assert.ok(background.includes("deltaOnly: true"));
  assert.ok(background.includes("continuous: payload.continuous === true"));
  assert.ok(background.includes("maxRounds: payload.maxRounds || 24"));
  assert.ok(background.includes("scanDeadlineAt + OPERATION_TIMEOUTS.PREVIEW_RESULT_GRACE_MS"));
  assert.ok(timeouts.includes("result?.scanMeta?.collectionFinishedAt"));
  assert.ok(timeouts.includes("result?.scanMeta?.workCompletedAt"));
  assert.ok(background.includes("滚动阶段只采集和去重；确认到底或到达统一截止时间后，才执行一次筛选"));
  assert.ok(!background.includes("targetPass"));
  assert.ok(!background.includes("maxScanJobs"));
  assert.ok(background.includes("collecting"));
  assert.ok(background.includes("const previewDeadlineAt = scanStartedAt + maxElapsedMs"));
  assert.ok(background.includes("scrollElapsedMs: collectionFinishedAt - scanStartedAt"));
  assert.ok(!background.includes("scrollElapsedMs: Math.min"));
  assert.ok(background.includes("resolvePreviewScanStop"));
  assert.ok(background.includes("滚动阶段只采集和去重"));
  assert.ok(!background.includes("SCAN_WORKER_OPEN_FAILED"));
  assert.ok(background.includes("正在当前职位页向下加载岗位"));
  assert.ok(background.includes("SCAN_PROGRESS"));
  assert.ok(content.includes("reportScanProgress"));
  assert.ok(content.includes("SCAN_PROGRESS: \"BHT_SCAN_PROGRESS\""));
  assert.ok(!panel.includes("到达列表底部或 60 秒"));
  assert.ok(!panel.includes("滚动用时"));
  assert.ok(panel.includes("elapsedSeconds"));
  assert.ok(panel.includes("previewScanFinishedAt"));
  assert.ok(panel.includes("正在加载岗位…"));
  assert.ok(!panel.includes("滚动已达到 60 秒上限"));
  assert.ok(!panel.includes("已加载 ${runner.previewScanned} 岗"));
});

test("continuous preview does not stop at the legacy 16-round cap", async () => {
  const harness = createVirtualScanHarness({
    totalJobs: 600,
    visibleJobs: 5,
    initialLoadedJobs: 15,
    appendBatchSize: 15
  });
  const result = await harness.scanAdaptiveJobBatch({
    scanSessionId: "continuous-large-list",
    resetSession: true,
    deltaOnly: false,
    continuous: true,
    scroll: true,
    maxRounds: 512,
    scrollWaitMs: 100,
    deadlineAt: 60000
  });

  assert.equal(result.count, 600);
  assert.equal(result.scanMeta.reachedEnd, true);
  assert.equal(result.scanMeta.timedOut, false);
  assert.ok(result.scanMeta.rounds > 16, `expected >16 rounds, got ${result.scanMeta.rounds}`);
});

test("virtual preview preserves the starting window and walks every overlapping viewport", async () => {
  const harness = createVirtualScanHarness({
    totalJobs: 12,
    visibleJobs: 4,
    initialTop: 400
  });
  const result = await harness.scanAdaptiveJobBatch({
    scanSessionId: "virtual-mid-list",
    resetSession: true,
    deltaOnly: false,
    scroll: true,
    maxRounds: 24,
    scrollWaitMs: 100,
    deadlineAt: 60000
  });

  assert.equal(
    harness.events[0]?.type,
    "collect",
    "the currently rendered jobs must be captured before resetting to the top"
  );
  assert.deepEqual(
    harness.collections[0]?.ids,
    ["job-4", "job-5", "job-6", "job-7"],
    "a scan started midway down the list must not discard that rendered window"
  );
  assert.equal(
    result.count,
    12,
    `all virtualized windows should be accumulated exactly once; got ${result.count} from ${JSON.stringify(harness.collections)}`
  );
  assert.deepEqual(
    result.jobs.map((job) => job.jobId).sort(),
    Array.from({ length: 12 }, (_, index) => `job-${index}`).sort()
  );

  const firstForwardScroll = harness.assignments.find((entry) => entry.actual > 0);
  assert.ok(firstForwardScroll, "the scan should move down after resetting to the top");
  assert.equal(firstForwardScroll.actual, 340, "each round should advance by 85% of one viewport");
});

test("large virtual preview does not skip middle windows", async () => {
  const harness = createVirtualScanHarness({ totalJobs: 100, visibleJobs: 5 });
  const result = await harness.scanAdaptiveJobBatch({
    scanSessionId: "virtual-100",
    resetSession: true,
    deltaOnly: false,
    continuous: true,
    scroll: true,
    maxRounds: 256,
    scrollWaitMs: 100,
    deadlineAt: 60000
  });
  assert.equal(result.count, 100);
  assert.deepEqual(
    result.jobs.map((job) => job.jobId).sort(),
    Array.from({ length: 100 }, (_, index) => `job-${index}`).sort()
  );
});

test("append-only preview loads 15 to 50 jobs at the fast cadence", async () => {
  const harness = createVirtualScanHarness({
    totalJobs: 50,
    visibleJobs: 5,
    initialLoadedJobs: 15,
    appendBatchSize: 15
  });
  const result = await harness.scanAdaptiveJobBatch({
    scanSessionId: "append-only-fast",
    resetSession: true,
    deltaOnly: false,
    scroll: true,
    maxRounds: 32,
    scrollWaitMs: 100,
    deadlineAt: 60000
  });

  assert.deepEqual(
    harness.events.filter((event) => event.type === "load").map((event) => event.loadedJobs),
    [30, 45, 50]
  );
  assert.equal(result.count, 50);
  assert.equal(result.scanMeta.reachedEnd, true);
  assert.equal(result.scanMeta.timedOut, false);
  assert.ok(harness.clock <= 7000, `fast lazy loading took ${harness.clock}ms in the fake clock`);
});

test("preview keeps already collected jobs when a wait is cancelled", async () => {
  const harness = createVirtualScanHarness({
    totalJobs: 90,
    visibleJobs: 5,
    initialLoadedJobs: 60,
    appendBatchSize: 15,
    cancelAfterSleeps: 1
  });
  const result = await harness.scanAdaptiveJobBatch({
    scanSessionId: "keep-jobs-on-cancel",
    resetSession: true,
    deltaOnly: false,
    continuous: true,
    scroll: true,
    maxRounds: 64,
    scrollWaitMs: 100,
    deadlineAt: 60000
  });

  assert.ok(result.count >= 60, `deadline cancel must keep the already loaded jobs; got ${result.count}`);
  assert.equal(result.scanMeta.timedOut, true);
  assert.equal(result.scanMeta.reachedEnd, false);
});

test("preview collection stops exactly at a mid-round deadline", async () => {
  const harness = createVirtualScanHarness({
    totalJobs: 100,
    visibleJobs: 5,
    initialLoadedJobs: 15,
    appendBatchSize: 15
  });
  const result = await harness.scanAdaptiveJobBatch({
    scanSessionId: "hard-deadline",
    resetSession: true,
    deltaOnly: false,
    scroll: true,
    maxRounds: 16,
    scrollWaitMs: 300,
    deadlineAt: 750
  });

  assert.equal(harness.clock, 750);
  assert.equal(result.scanMeta.elapsedMs, 750);
  assert.equal(result.scanMeta.timedOut, true);
  assert.equal(result.scanMeta.reachedEnd, false);
});

test("preview top stabilization consumes only the shared deadline budget", async () => {
  const harness = createVirtualScanHarness({
    totalJobs: 100,
    visibleJobs: 5,
    initialTop: 400,
    initialLoadedJobs: 15,
    appendBatchSize: 15
  });
  const result = await harness.scanAdaptiveJobBatch({
    scanSessionId: "top-reset-hard-deadline",
    resetSession: true,
    deltaOnly: false,
    scroll: true,
    maxRounds: 16,
    scrollWaitMs: 300,
    deadlineAt: 120
  });

  assert.equal(harness.clock, 120);
  assert.equal(result.scanMeta.elapsedMs, 120);
  assert.equal(result.scanMeta.timedOut, true);
  assert.equal(result.scanMeta.reachedEnd, false);
});

test("virtual preview reacquires a replaced scroll container between rounds", async () => {
  const harness = createVirtualScanHarness({
    totalJobs: 8,
    visibleJobs: 4,
    initialTop: 0,
    replaceScrollerAfterSleeps: 1
  });
  const result = await harness.scanAdaptiveJobBatch({
    scanSessionId: "virtual-replaced-scroller",
    resetSession: true,
    deltaOnly: false,
    scroll: true,
    maxRounds: 12,
    scrollWaitMs: 300,
    deadlineAt: 60000
  });

  assert.ok(
    harness.assignments.some((entry) => entry.generation === 2),
    "later rounds must scroll the replacement container instead of a detached node"
  );
  assert.ok(
    harness.collections.some((entry) => entry.generation === 2),
    "jobs rendered by the replacement container must be collected"
  );
  assert.equal(
    result.count,
    8,
    `container replacement must not truncate the accumulated scan; got ${result.count} from ${JSON.stringify(harness.collections)}`
  );
});

test("preview terminal metadata keeps reachedEnd and timedOut mutually exclusive", async () => {
  const policy = await import("../extension/shared/preview-scan-policy.js");
  assert.equal(
    typeof policy.normalizePreviewScanTerminalState,
    "function",
    "preview-scan-policy must expose the terminal-state normalizer used by background finalization"
  );
  assert.deepEqual(
    policy.normalizePreviewScanTerminalState({ reachedEnd: true, timedOut: true }),
    { reachedEnd: false, timedOut: true }
  );
  assert.deepEqual(
    policy.normalizePreviewScanTerminalState({
      reachedEnd: true,
      timedOut: false,
      deadlineAt: 1000,
      now: 1001
    }),
    { reachedEnd: true, timedOut: false },
    "a bottom confirmed before return processing must remain a bottom result"
  );
  assert.deepEqual(
    policy.normalizePreviewScanTerminalState({
      reachedEnd: false,
      timedOut: false,
      deadlineAt: 1000,
      now: 1001
    }),
    { reachedEnd: false, timedOut: true }
  );

  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const runStart = background.indexOf("async function runPreview");
  const runEnd = background.indexOf("function itemErrorHint", runStart);
  const runPreview = background.slice(runStart, runEnd);
  assert.ok(
    runPreview.includes("normalizePreviewScanTerminalState"),
    "runPreview finalization must normalize the two terminal flags before publishing scanMeta"
  );
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
  assert.ok(content.includes("if (opId && window.__BHT_OP_CANCELLED__?.[opId])"));
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

test("preview navigation recovery and scan bridge failures share the hard deadline", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const waitTabComplete = extractFunctionSource(
    background,
    "async function waitTabComplete",
    "async function getDisplayMetrics"
  );
  const navigatePreview = extractFunctionSource(
    background,
    "async function navigatePreviewToJobList",
    "async function restoreListTabAfterTriggerNavigation"
  );
  const scanPreview = extractFunctionSource(
    background,
    "async function scanPreviewJobs",
    "function evaluatePreviewResults"
  );
  const sendToBoss = extractFunctionSource(
    background,
    "async function sendToBoss",
    "async function assertBossContext"
  );

  assert.ok(waitTabComplete.includes("Math.min(timeoutDeadlineAt, Number(deadlineAt))"));
  assert.ok(waitTabComplete.includes("Math.min(200, remainingMs)"));
  assert.ok(navigatePreview.includes("deadlineAt = 0"));
  assert.ok(navigatePreview.includes(
    "remainingDeadlineMs(deadlineAt, OPERATION_TIMEOUTS.PREVIEW_LIST_NAV_MS)"
  ));
  assert.ok(navigatePreview.includes("deadlineAt\n    })"));
  assert.ok(navigatePreview.includes("previewScanDeadlineResult"));
  assert.ok(scanPreview.includes(
    "remainingDeadlineMs(\n      scanPayload.deadlineAt,\n      OPERATION_TIMEOUTS.PREVIEW_LIST_NAV_MS"
  ));
  assert.ok(scanPreview.includes("deadlineAt: scanPayload.deadlineAt"));
  assert.ok(scanPreview.includes("setPreviewPhase('collecting', previewRunId)"));
  assert.ok(!scanPreview.includes("setPreviewPhase('locating_list'"));
  assert.ok(scanPreview.includes("scanPayload.deadlineAt\n    )"));
  assert.ok(scanPreview.includes("error: 'OP_DEADLINE_EXCEEDED'") ||
    scanPreview.includes("previewScanDeadlineResult()"));

  assert.ok(sendToBoss.includes("forceInjectContent(tab.id, { deadlineAt: scanDeadlineAt })"));
  assert.ok(sendToBoss.includes("sleepWithinDeadline(220, scanDeadlineAt)"));
  assert.ok(sendToBoss.includes("sleepWithinDeadline(280, scanDeadlineAt)"));
  const deadlineCheckAt = sendToBoss.indexOf("if (scanDeadlineAt && deadlineReached(scanDeadlineAt)) break;");
  const navigationProbeAt = sendToBoss.indexOf("if (type === MSG.SCAN_JOBS && Date.now() >= navigationProbeAt)");
  assert.ok(deadlineCheckAt >= 0 && deadlineCheckAt < navigationProbeAt);

  const failedOperationAt = sendToBoss.indexOf("const failedOperation =");
  const failedOperationEnd = sendToBoss.indexOf("operations.delete(bridgeOpId)", failedOperationAt);
  const failedOperationBlock = sendToBoss.slice(failedOperationAt, failedOperationEnd);
  const scanCatchAt = failedOperationBlock.indexOf("if (type === MSG.SCAN_JOBS)");
  const nonScanElseAt = failedOperationBlock.indexOf("} else {", scanCatchAt);
  const scanCatch = failedOperationBlock.slice(scanCatchAt, nonScanElseAt);
  assert.ok(scanCatch.includes("await requestBridgeCancellation(failedOperation)"));
  assert.ok(scanCatch.includes("scheduleBridgeStorageCleanup(failedOperation.storageKey)"));
  assert.ok(!scanCatch.includes("cancelBridgeOperation"));
  assert.ok(failedOperationBlock.slice(nonScanElseAt).includes("await cancelBridgeOperation(failedOperation)"));
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
  assert.ok(runPreview.includes("const sourcePreviewTab = previewTab || await getActiveBossTab"));
  assert.ok(runPreview.indexOf("if (!isActive()) return cancelled();", runPreview.indexOf("const scanResult")) > -1);
});

test("preview scans the current SPA list and uses lightweight one-second status updates", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const panel = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const host = fs.readFileSync("extension/content/floating-host.js", "utf8");
  const debugLog = fs.readFileSync("extension/shared/debug-log.js", "utf8");
  assert.ok(background.includes("previewTab = sourcePreviewTab"));
  assert.ok(background.includes("sourceContextPreserved: true"));
  assert.ok(!background.includes("openPreviewScanWorker"));
  assert.ok(!background.includes("SCAN_WORKER_OPEN_FAILED"));
  assert.ok(content.includes("savedListHref: savedHref"));
  assert.ok(content.includes("savedListFilterHints"));
  assert.ok(content.includes("listHref,"));
  assert.ok(content.includes("listFilterHints"));
  assert.ok(content.includes("describeAdaptiveScanScroller"));
  assert.ok(content.includes("growthEvents"));
  assert.ok(content.includes("bottomStableRounds >= 8"));
  assert.ok(content.includes("if (timedOut) session.reachedEnd = false"));
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

test("preview continuously collects on the source tab and filters once afterwards", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const runStart = background.indexOf("async function runPreview");
  const runEnd = background.indexOf("function itemErrorHint", runStart);
  const run = background.slice(runStart, runEnd);
  assert.ok(run.includes("previewTab = sourcePreviewTab"));
  assert.ok(run.includes("const collectedJobs = new Map()"));
  assert.ok(run.includes("mergePreviewJobBatch(collectedJobs, more?.jobs || [])"));
  assert.ok(run.indexOf("while (scan.scanMeta?.reachedEnd") < run.indexOf("const results = evaluatePreviewResults"));
  assert.equal((run.match(/evaluatePreviewResults\(/g) || []).length, 1);
  assert.ok(run.includes("const previewDeadlineAt = scanStartedAt + maxElapsedMs"));
  assert.ok(run.includes("previewDeadlineAt - OPERATION_TIMEOUTS.PREVIEW_RESULT_GRACE_MS"));
  assert.ok(run.includes("scanDeadlinePartial"));
  assert.ok(run.includes("continuous: true"));
  assert.ok(!run.includes("listExpectLabel: scanWorkerTab"));
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
  assert.ok(app.includes("filterHistoryByDate(history, fromTs, toTs)"), "history date filter wired");
  assert.ok(app.includes("filterHistoryRows(byDate, filter)"), "status filter applies after date filter");
  assert.ok(app.includes("historyToday"), "today counter line present");
  assert.ok(app.includes("今日已投"), "today counter label present");
  assert.ok(app.includes("dailyMaxCommunicate"), "today counter uses daily limit");
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

test("v1.7.19 worker tab reuse, inject budget and env auto-skip are wired", () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const content = fs.readFileSync("extension/content/content-main.js", "utf8");
  const debugLog = fs.readFileSync("extension/shared/debug-log.js", "utf8");
  const envFail = fs.readFileSync("extension/shared/environment-failures.js", "utf8");

  // 执行页跨岗位复用：命中既有 workerTabId 时导航复用，而不是每岗新建+关闭
  assert.ok(background.includes("autoDiscardable"), "worker tab must not be memory-recycled");
  assert.ok(background.includes("await chrome.tabs.update(tab.id, { url: attempt.url, active: false })"), "reuse navigates existing worker tab");
  assert.ok(background.includes("let reused = Boolean(tab?.id)"), "reuse flag computed");
  assert.ok(!background.includes("本岗位沟通触发结束"), "worker tab is no longer closed per job");

  // 注入/加载硬预算：繁忙渲染进程不再造成 60-90s 黑洞
  assert.ok(background.includes("injectWithBudget"), "inject budget helper present");
  assert.ok(background.includes("临时沟通执行页内容脚本注入超时"), "inject timeout fails fast");

  // 渲染就绪门 + 点击补偿 + 快速失败
  assert.ok(content.includes("RENDER_GATE_MS"), "render gate present");
  assert.ok(content.includes('error: "WORKER_PAGE_NOT_READY"'), "not-ready fast fail present");
  assert.ok(content.includes('error: "WORKER_CHAT_CLICK_NO_EFFECT"'), "no-effect fast fail present");
  assert.ok(content.includes("worker_detail_click_retry"), "click compensation retry present");
  assert.ok(content.includes("isConversationNavigationStarted"), "navigation detection helper present");

  // 调试日志限频 + 非阻塞
  assert.ok(content.includes("debugTraceThrottles"), "content debug throttle map present");
  assert.ok(debugLog.includes("FLUSH_INTERVAL_MS"), "coalesced flush interval present");
  const floatHost = fs.readFileSync("extension/content/floating-host.js", "utf8");
  assert.ok(floatHost.includes("自愈：面板打开状态因页面重载"), "float auto-reopens after page reload");
  assert.ok(debugLog.includes("Promise.resolve(entry)"), "append never awaits storage flush");

  // 环境失败分类共享模块接入后台
  assert.ok(envFail.includes("ENV_AUTO_CONTINUE_ERRORS"), "env set exported");
  assert.ok(background.includes("from '../shared/environment-failures.js'"), "background imports env classifier");
  assert.ok(background.includes("CONTENT_INJECT_FAIL"), "inject timeout fails fast with env error");
  assert.ok(background.includes("BOSS 页面脚本注入失败或超时"), "inject failure message present");
  assert.ok(background.includes("envAutoSkip"), "queue stamps env skip flag");
  assert.ok(background.includes("[自动跳过]"), "queue logs auto skip");
  assert.ok(background.includes("row?.envAutoSkip === true"), "queue skips confirm loop for env failures");
});





test("v1.7.19 openConversationWorkerTab reuses one worker tab across jobs", async () => {
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const source = extractFunctionSource(
    background,
    "function detailJobIdFromHref",
    "async function openConversationWorkerTab"
  ) + "\n" + extractFunctionSource(
    background,
    "async function openConversationWorkerTab",
    "async function triggerConversationInWorker"
  );
  let seq = 1;
  const tabs = [];
  const calls = { create: 0, update: [] };
  const chromeStub = {
    tabs: {
      get: async (id) => {
        const found = tabs.find((t) => t.id === id);
        if (!found) throw new Error("No tab with id: " + id);
        return found;
      },
      create: async (opts) => {
        calls.create += 1;
        const t = { id: 1000 + seq++, url: opts.url, windowId: 1, active: opts.active };
        tabs.push(t);
        return t;
      },
      update: async (id, props) => {
        const t = tabs.find((x) => x.id === id);
        if (!t) throw new Error("no tab " + id);
        calls.update.push({ id, props });
        Object.assign(t, props);
        return t;
      }
    }
  };
  const budgetLog = [];
  const waitTabComplete = async (tabId, budgetMs) => {
    budgetLog.push({ tabId, budgetMs });
    // 模拟真实导航：返回最近一次 tabs.update 的目标 URL（无导航时回退到底站）
    const lastNav = [...calls.update].reverse().find((u) => u.props.url);
    const url = lastNav ? lastNav.props.url : "https://www.zhipin.com/job_detail/feedfacefeedfacefeed.html";
    return { id: tabId, url, status: "complete" };
  };
  const forceInjectContent = async () => true;
  const sleep = async () => {};
  const publishTask = async () => {};
  const factory = new Function(
    "chrome",
    "waitTabComplete",
    "forceInjectContent",
    "sleep",
    "publishTask",
    "isBossUrl",
    source + "; return openConversationWorkerTab;"
  );
  const open = factory(chromeStub, waitTabComplete, forceInjectContent, sleep, publishTask, isBossUrl);
  const task = { execution: {} };
  const messageTab = { id: 7, windowId: 3 };
  const job = { jobId: "j1", title: "T" };
  const attempt = { mode: "detail", url: "https://www.zhipin.com/job_detail/feedfacefeedfacefeed.html" };

  // 第 1 岗：无历史执行页 → 新建
  const first = await open(task, attempt, messageTab, job);
  assert.equal(calls.create, 1, "first job creates one tab");
  assert.equal(first.id, task.execution.workerTabId, "execution tracks the created tab");
  assert.equal(calls.update[0].props.autoDiscardable, false, "created tab protected from memory recycle");
  assert.deepEqual(budgetLog[0], { tabId: first.id, budgetMs: 30000 }, "first load uses default 30s budget");

  // 第 2 岗：执行页存在 → 复用导航，不再新建
  const secondAttempt = { ...attempt, url: "https://www.zhipin.com/job_detail/feedfacefeedfacefeed2.html" };
  const second = await open(task, secondAttempt, messageTab, job);
  assert.equal(calls.create, 1, "second job reuses instead of creating");
  assert.equal(second.id, first.id, "reuse keeps the same tab id");
  const navUpdate = calls.update.find((u) => u.props.url === secondAttempt.url);
  assert.ok(navUpdate && navUpdate.id === first.id, "navigation goes to the same tab");
  assert.deepEqual(budgetLog[1], { tabId: first.id, budgetMs: 45000 }, "reused navigation gets the longer 45s budget");

  // 第 3 场：复用导航未提交（waitTabComplete 仍返回上一岗位详情）→ 防误点护栏拒绝
  const staleOpen = factory(
    chromeStub,
    async (tabId) => ({ id: tabId, url: "https://www.zhipin.com/job_detail/OLDJOBOLDJOBOLDJOB.html", status: "complete" }),
    forceInjectContent,
    sleep,
    publishTask,
    isBossUrl
  );
  const staleTask = { execution: { workerTabId: first.id } };
  let staleError = null;
  try { await staleOpen(staleTask, secondAttempt, messageTab, job); } catch (e) { staleError = String((e && e.message) || e); }
  assert.ok(staleError && staleError.includes('导航未生效'), "stale old detail page must be rejected, got " + staleError);

  // 第 3 岗：执行页被外部关闭 → 重建
  const closedId = first.id;
  const idx = tabs.findIndex((t) => t.id === closedId);
  tabs.splice(idx, 1);
  // 保留 execution.workerTabId：模拟「执行页被外部关闭」而非执行字段被清空，
  // 真正走 tabs.get 抛错 → 重建路径
  // （delete task.execution.workerTabId;）
  const third = await open(task, attempt, messageTab, job);
  assert.equal(calls.create, 2, "closed worker tab is recreated");
  assert.notEqual(third.id, closedId, "new tab id after recreate");
  assert.deepEqual(budgetLog[2], { tabId: third.id, budgetMs: 30000 }, "recreated load uses default budget");
});


test("v1.7.20 history date filter, full config import and trigger dedup mark are wired", () => {
  const app = fs.readFileSync("extension/sidepanel/app.js", "utf8");
  const html = fs.readFileSync("extension/sidepanel/index.html", "utf8");
  const storage = fs.readFileSync("extension/shared/storage.js", "utf8");
  const background = fs.readFileSync("extension/background/service-worker.js", "utf8");
  const historyView = fs.readFileSync("extension/shared/history-view.js", "utf8");
  // 日期筛选与今日计数
  assert.ok(html.includes('id="historyFrom"') && html.includes('id="historyTo"'), "date inputs present");
  assert.ok(html.includes('id="historyToday"'), "today counter line present");
  assert.ok(app.includes("filterHistoryByDate(history, fromTs, toTs)"), "date filter applied");
  assert.ok(app.includes("summarizeHistory(filtered)"), "stats reflect filtered rows");
  assert.ok(historyView.includes("startOfLocalDay") && historyView.includes("endOfLocalDay"), "day boundary helpers");
  // 全量导出/导入
  assert.ok(storage.includes("dailyStats: STORAGE_KEYS.DAILY_STATS"), "dailyStats exported");
  assert.ok(storage.includes("idempotency: STORAGE_KEYS.IDEMPOTENCY"), "idempotency exported");
  assert.ok(storage.includes("task: STORAGE_KEYS.TASK"), "task exported");
  assert.ok(storage.includes("sanitizeImportedTask"), "imported task sanitized");
  // 触发即防重复
  assert.ok(background.includes("markIdempotent(jobIdempotencyKey(job)") &&
    background.includes("防重复：沟通一旦发起"), "job marked idempotent at trigger");
  // P1: 触发/完成两条 job 级标记都必须携带 securityId（完成路径不得覆盖掉触发时的重发证据）
  const jobMarks = background.match(/markIdempotent\(jobIdempotencyKey\(job\), \{[^}]*\}\)/g) || [];
  assert.ok(jobMarks.length >= 2, "job-level idempotent marks exist at trigger and complete paths");
  assert.ok(jobMarks.every((m) => m.includes("securityId")), "every job-level mark keeps securityId");
});


await runRegisteredTests();

if (!process.exitCode) console.log("flow contract tests ok");
