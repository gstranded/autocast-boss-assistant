(() => {
  const MSG = {
    PING: "BHT_PING",
    SCAN_JOBS: "BHT_SCAN_JOBS",
    SCAN_PROGRESS: "BHT_SCAN_PROGRESS",
    START_CHAT: "BHT_START_CHAT",
    TRIGGER_CONVERSATION: "BHT_TRIGGER_CONVERSATION",
    INSPECT_JOB_DETAIL: "BHT_INSPECT_JOB_DETAIL",
    ENRICH_JOB_ACTIVITY: "BHT_ENRICH_JOB_ACTIVITY",
    GET_CONVERSATION_SNAPSHOT: "BHT_GET_CONVERSATION_SNAPSHOT",
    WAIT_OPEN_CONVERSATION: "BHT_WAIT_OPEN_CONVERSATION",
    WAIT_CHAT_EDITOR: "BHT_WAIT_CHAT_EDITOR",
    GET_CHAT_SELF_MESSAGES: "BHT_GET_CHAT_SELF_MESSAGES",
    GET_BOSS_GREETING: "BHT_GET_BOSS_GREETING",
    SET_BOSS_GREETING: "BHT_SET_BOSS_GREETING",
    SAVE_BOSS_GREETING_TEXT: "BHT_SAVE_BOSS_GREETING_TEXT",
    SEND_TEXT: "BHT_SEND_TEXT",
    SEND_IMAGE: "BHT_SEND_IMAGE",
    HIGHLIGHT_JOBS: "BHT_HIGHLIGHT_JOBS",
    ENSURE_JOB_LIST: "BHT_ENSURE_JOB_LIST",
    RETURN_TO_LIST: "BHT_RETURN_TO_LIST",
    SCROLL_LIST_TOP: "BHT_SCROLL_LIST_TOP",
    CLOSE_CHAT: "BHT_CLOSE_CHAT",
    DIAGNOSE: "BHT_DIAGNOSE",
    RUN_OP: "BHT_RUN_OP",
    CANCEL_OP: "BHT_CANCEL_OP",
    DEBUG_EVENT: "BHT_DEBUG_EVENT"
  };

  const BHT_CONTENT_VERSION = "1.7.22";
  // 版本化热更新：扩展重载后可重新注入，不卡在旧脚本
  if (
    window.__BHT_CONTENT_VERSION__ === BHT_CONTENT_VERSION &&
    window.__BHT_ON_MESSAGE__ &&
    window.__BHT_CONTENT_INSTANCE_ID__
  ) {
    return;
  }
  if (window.__BHT_ON_MESSAGE__) {
    try { chrome.runtime.onMessage.removeListener(window.__BHT_ON_MESSAGE__); } catch (_) {}
  }
  window.__BHT_CONTENT_VERSION__ = BHT_CONTENT_VERSION;
  const BHT_CONTENT_INSTANCE_ID = `content_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  window.__BHT_CONTENT_INSTANCE_ID__ = BHT_CONTENT_INSTANCE_ID;
  window.__BHT_OP_LOCK__ = null; // boot: 导航后新脚本不继承旧锁
  window.__BHT_OP_CANCELLED__ = Object.create(null);
  window.__BHT_OP_TIMED_OUT__ = Object.create(null);
  window.__BHT_ACTIVE_OP_ID__ = null;
  window.__BHT_ACTIVE_OP_TYPE__ = null;
  window.__BHT_CONTENT_LOADED__ = true;
  window.__BHT_LAST_TRIGGER_CLICK__ = null;
  const nativeGreetingReceipts = [];
  const jobNetworkMetadata = new Map();

  function rememberJobNetworkMetadata(raw = {}) {
    const jobId = String(raw.jobId || '').trim();
    if (!jobId) return null;
    const previous = jobNetworkMetadata.get(jobId) || {};
    const next = {
      ...previous,
      ...raw,
      jobId,
      securityId: String(raw.securityId || previous.securityId || ''),
      lid: String(raw.lid || previous.lid || ''),
      bossId: String(raw.bossId || previous.bossId || ''),
      bossName: String(raw.bossName || previous.bossName || '').trim(),
      bossTitle: String(raw.bossTitle || previous.bossTitle || '').trim(),
      brandName: String(raw.brandName || previous.brandName || '').trim(),
      activeText: String(raw.activeText || previous.activeText || '').trim(),
      bossOnline: typeof raw.bossOnline === 'boolean'
        ? raw.bossOnline
        : previous.bossOnline === true,
      goldHunter: raw.goldHunter === true || raw.goldHunter === 1 || previous.goldHunter === true,
      receivedAt: Date.now()
    };
    jobNetworkMetadata.set(jobId, next);
    if (jobNetworkMetadata.size > 2000) {
      const oldest = jobNetworkMetadata.keys().next().value;
      if (oldest) jobNetworkMetadata.delete(oldest);
    }
    return next;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "bht-page-network-hook") return;
    if (data.type === "job-metadata") {
      for (const job of Array.isArray(data.jobs) ? data.jobs : []) rememberJobNetworkMetadata(job);
      return;
    }
    if (data.type !== "friend-add-receipt") return;
    nativeGreetingReceipts.push({
      at: Number(data.at || Date.now()),
      jobId: String(data.jobId || ""),
      ok: data.ok === true,
      code: Number(data.code),
      hasShowGreeting: data.hasShowGreeting === true,
      showGreeting: data.hasShowGreeting === true ? data.showGreeting === true : null,
      greeting: String(data.greeting || "")
    });
    if (nativeGreetingReceipts.length > 30) nativeGreetingReceipts.splice(0, nativeGreetingReceipts.length - 30);
    debugTrace("friend_add_receipt", nativeGreetingReceipts[nativeGreetingReceipts.length - 1]);
  });
  try {
    window.postMessage({ source: 'bht-content', type: 'job-metadata-request' }, location.origin);
  } catch (_) {}

  function isBossHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "zhipin.com" || host.endsWith(".zhipin.com") ||
      host === "bosszhipin.com" || host.endsWith(".bosszhipin.com");
  }

  // 双保险：即使被错误注入到其他页面也立即退出，不注册监听、不改 DOM
  if (!isBossHost(location.hostname)) {
    console.log("[BHT content] inactive on non-BOSS host:", location.hostname);
    return;
  }


  const log = (...args) => console.log("[BHT content]", ...args);

  const debugTraceThrottles = Object.create(null);
  function debugTrace(event, data = {}, level = "debug", throttleMs = 0) {
    if (window.__BHT_DEBUG_ENABLED__ !== true) return;
    // 高频事件（DOM 变更/事件）按事件名限流，避免日志洪水挤占运行时消息通道
    if (throttleMs > 0) {
      const nowMs = Date.now();
      const prevMs = Number(debugTraceThrottles[event] || 0);
      if (nowMs - prevMs < throttleMs) return;
      debugTraceThrottles[event] = nowMs;
    }
    try {
      chrome.runtime.sendMessage({
        type: MSG.DEBUG_EVENT,
        payload: {
          ts: Date.now(),
          level,
          scope: "content",
          event,
          data: {
            href: location.href,
            opId: window.__BHT_ACTIVE_OP_ID__ || null,
            ...data
          }
        }
      }).catch(() => {});
    } catch (_) {}
  }

  function serializeDebugError(error) {
    if (!error) return null;
    return {
      name: String(error.name || "Error"),
      message: String(error.message || error),
      code: error.code || "",
      stack: String(error.stack || "").slice(0, 8000)
    };
  }

  function summarizeOperationResult(result) {
    if (!result || typeof result !== 'object') return result;
    return {
      ok: result.ok === true,
      error: result.error || '',
      message: result.message || '',
      count: Number(result.count || 0),
      contentVersion: result.contentVersion || BHT_CONTENT_VERSION,
      scanMeta: result.scanMeta || null,
      receipt: result.receipt ? {
        type: result.receipt.type || '',
        status: result.receipt.status || '',
        receiptId: result.receipt.receiptId || ''
      } : null
    };
  }

  function describeDebugElement(el) {
    if (!el || typeof el !== "object") return null;
    let rect = null;
    try {
      const box = el.getBoundingClientRect?.();
      if (box) {
        rect = {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height)
        };
      }
    } catch (_) {}
    return {
      tag: String(el.tagName || ""),
      id: String(el.id || ""),
      className: String(el.className || "").slice(0, 400),
      role: String(el.getAttribute?.("role") || ""),
      text: String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500),
      href: String(el.getAttribute?.("href") || "").slice(0, 600),
      name: String(el.getAttribute?.("name") || ""),
      ariaLabel: String(el.getAttribute?.("aria-label") || "").slice(0, 300),
      dataKa: String(el.getAttribute?.("ka") || ""),
      disabled: Boolean(el.disabled),
      connected: Boolean(el.isConnected),
      valueLength: typeof el.value === "string" ? el.value.length : null,
      rect
    };
  }

  function installDebugInstrumentation() {
    try { window.__BHT_DEBUG_INSTRUMENTATION_CLEANUP__?.(); } catch (_) {}
    const eventTypes = ["mousedown", "mouseup", "click", "keydown", "input", "change", "submit"];
    const onDomEvent = (event) => {
      if (
        window.__BHT_DEBUG_ENABLED__ !== true ||
        !window.__BHT_ACTIVE_OP_ID__ ||
        window.__BHT_ACTIVE_OP_TYPE__ === MSG.SCAN_JOBS
      ) return;
      // mousedown/mouseup/input/change 每操作数十条；只留 click/submit 且限流，日志洪峰不再挤占通道
      if (event.type !== "click" && event.type !== "submit") return;
      debugTrace("dom_event", {
        type: event.type,
        isTrusted: Boolean(event.isTrusted),
        defaultPrevented: Boolean(event.defaultPrevented),
        button: Number.isFinite(event.button) ? event.button : null,
        key: event.type === "keydown" ? String(event.key || "") : "",
        code: event.type === "keydown" ? String(event.code || "") : "",
        modifiers: {
          alt: Boolean(event.altKey),
          ctrl: Boolean(event.ctrlKey),
          meta: Boolean(event.metaKey),
          shift: Boolean(event.shiftKey)
        },
        target: describeDebugElement(event.target)
      }, "debug", 300);
    };
    eventTypes.forEach((type) => document.addEventListener(type, onDomEvent, true));

    const onWindowError = (event) => {
      if (window.__BHT_DEBUG_ENABLED__ !== true) return;
      debugTrace("window_error", {
        message: String(event.message || ""),
        filename: String(event.filename || ""),
        line: event.lineno || 0,
        column: event.colno || 0,
        error: serializeDebugError(event.error)
      }, "error");
    };
    const onUnhandledRejection = (event) => {
      if (window.__BHT_DEBUG_ENABLED__ !== true) return;
      debugTrace("unhandled_rejection", {
        error: serializeDebugError(event.reason),
        reason: String(event.reason?.message || event.reason || "")
      }, "error");
    };
    window.addEventListener("error", onWindowError, true);
    window.addEventListener("unhandledrejection", onUnhandledRejection, true);

    let mutationTimer = 0;
    let mutationCount = 0;
    let addedCount = 0;
    let removedCount = 0;
    let mutationSamples = [];
    const observer = new MutationObserver((mutations) => {
      if (
        window.__BHT_DEBUG_ENABLED__ !== true ||
        !window.__BHT_ACTIVE_OP_ID__ ||
        window.__BHT_ACTIVE_OP_TYPE__ === MSG.SCAN_JOBS
      ) return;
      mutationCount += mutations.length;
      for (const mutation of mutations) {
        addedCount += mutation.addedNodes?.length || 0;
        removedCount += mutation.removedNodes?.length || 0;
        if (mutationSamples.length < 12) {
          const sample = mutation.addedNodes?.[0] || mutation.removedNodes?.[0] || mutation.target;
          if (sample?.nodeType === 1) mutationSamples.push(describeDebugElement(sample));
        }
      }
      if (!mutationTimer) {
        mutationTimer = setTimeout(() => {
          debugTrace("dom_mutation_batch", {
            mutationCount,
            addedCount,
            removedCount,
            samples: mutationSamples
          }, "debug", 400);
          mutationTimer = 0;
          mutationCount = 0;
          addedCount = 0;
          removedCount = 0;
          mutationSamples = [];
        }, 180);
      }
    });
    try { observer.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}

    window.__BHT_DEBUG_INSTRUMENTATION_CLEANUP__ = () => {
      eventTypes.forEach((type) => document.removeEventListener(type, onDomEvent, true));
      window.removeEventListener("error", onWindowError, true);
      window.removeEventListener("unhandledrejection", onUnhandledRejection, true);
      observer.disconnect();
      if (mutationTimer) clearTimeout(mutationTimer);
    };
  }

  installDebugInstrumentation();

  
  function isListLikePage(href = location.href) {
    try {
      const parsed = new URL(String(href || ""), location.origin);
      // 只按 pathname 判断，避免详情页 query 中的 search/recommend 参数
      // 被误认成职位列表，导致续批扫描跳过列表恢复。
      return /\/web\/geek\/jobs|\/recommend(?:\/|$)|\/search(?:\/|$)|\/rec-job(?:\/|$)|\/job-recommend(?:\/|$)|\/geek\/job(?!_detail)(?:\/|$)/i.test(parsed.pathname);
    } catch (_) {
      return false;
    }
  }

  function sameListUrl(a, b) {
    try {
      const ua = new URL(String(a || ""), location.origin);
      const ub = new URL(String(b || ""), location.origin);
      return ua.origin === ub.origin && ua.pathname === ub.pathname && ua.search === ub.search;
    } catch (_) {
      return String(a || "").split("#")[0] === String(b || "").split("#")[0];
    }
  }

  function detectSelectedJobExpect() {
    try {
      const selectors = [
        ".expect-list .active",
        ".expect-list .selected",
        ".job-expect .active",
        ".job-expect .selected",
        ".expect-item.active",
        ".expect-item.selected",
        ".expect-list [class*='active']",
        ".job-expect-list [class*='active']",
        "[class*='expect'] [class*='active']",
        ".recommend-job-slider .active",
        ".job-tab .active",
        ".expect-select .active"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        const t = textOf(el).replace(/\s+/g, " ").trim();
        if (t && t.length >= 1 && t.length <= 40) return t;
      }
      const candidates = Array.from(document.querySelectorAll("div, span, a, li, button")).filter((el) => {
        try {
          const r = el.getBoundingClientRect();
          if (r.top < 0 || r.top > 220 || r.width < 20 || r.height < 16 || r.height > 60) return false;
          const cls = String(el.className || "");
          const t = textOf(el).replace(/\s+/g, " ").trim();
          if (!t || t.length > 36) return false;
          if (!/(推荐|期望|工程师|开发|产品|运营|设计|实习|全职|兼职|销售)/.test(t) && !/expect|recommend|job-tab/i.test(cls)) {
            return false;
          }
          return /active|selected|current|\bon\b/i.test(cls) || el.getAttribute("aria-selected") === "true";
        } catch (_) {
          return false;
        }
      });
      if (candidates[0]) return textOf(candidates[0]).replace(/\s+/g, " ").trim();
    } catch (_) {}
    return "";
  }

  function detectActiveFilterHints() {
    try {
      const hints = [];
      const nodes = Array.from(
        document.querySelectorAll(
          ".filter-select-item.active, .condition-filter-select .active, .search-condition .active, .filter-item.active, .job-search-filter .active, [class*='filter'] [class*='active']"
        )
      ).slice(0, 20);
      for (const el of nodes) {
        const t = textOf(el).replace(/\s+/g, " ").trim();
        if (t && t.length <= 30 && !hints.includes(t)) hints.push(t);
      }
      return hints.slice(0, 12);
    } catch (_) {
      return [];
    }
  }

  function getSavedListCtx() {
    try {
      if (window.__BHT_LIST_CTX__ && typeof window.__BHT_LIST_CTX__ === "object") {
        return window.__BHT_LIST_CTX__;
      }
      const raw = sessionStorage.getItem("bht_list_ctx");
      if (raw) return JSON.parse(raw) || {};
    } catch (_) {}
    return {};
  }

  function rememberListHref(forceHref) {
    try {
      const href = forceHref || location.href;
      const cards = getJobCards().length;
      if (forceHref || (cards >= 3 && isListLikePage(href))) {
        const ctx = {
          href,
          expectLabel: detectSelectedJobExpect(),
          filterHints: detectActiveFilterHints(),
          at: Date.now()
        };
        sessionStorage.setItem("bht_list_href", href);
        sessionStorage.setItem("bht_list_ctx", JSON.stringify(ctx));
        window.__BHT_LIST_HREF__ = href;
        window.__BHT_LIST_CTX__ = ctx;
        return href;
      }
    } catch (_) {}
    return sessionStorage.getItem("bht_list_href") || window.__BHT_LIST_HREF__ || "";
  }

  function getSavedListHref() {
    try {
      return window.__BHT_LIST_HREF__ || sessionStorage.getItem("bht_list_href") || "";
    } catch (_) {
      return window.__BHT_LIST_HREF__ || "";
    }
  }

  function getSavedJobListNavigationTarget() {
    const saved = getSavedListHref();
    try {
      const parsed = new URL(saved || "", location.origin);
      if (isBossHost(parsed.hostname) && isListLikePage(parsed.href)) return parsed.href;
    } catch (_) {}
    return "";
  }

  function getJobListNavigationTarget() {
    const saved = getSavedJobListNavigationTarget();
    if (saved) return saved;
    try {
      return new URL("/web/geek/jobs", location.origin).href;
    } catch (_) {
      return "https://www.zhipin.com/web/geek/jobs";
    }
  }

  async function restoreJobExpectIfNeeded(wantLabel) {
    const want = String(wantLabel || getSavedListCtx()?.expectLabel || "").replace(/\s+/g, " ").trim();
    if (!want) return { ok: true, skipped: true };
    const current = detectSelectedJobExpect();
    if (current && (current === want || current.includes(want) || want.includes(current))) {
      return { ok: true, already: true, label: current };
    }
    try {
      const nodes = Array.from(document.querySelectorAll("div, span, a, li, button")).filter((el) => {
        try {
          const r = el.getBoundingClientRect();
          if (r.width < 12 || r.height < 12 || r.top > 280) return false;
          const t = textOf(el).replace(/\s+/g, " ").trim();
          if (!t) return false;
          if (t === want || t.includes(want) || want.includes(t)) return true;
          const core = want.split(/[·•|/｜]/)[0].trim();
          return Boolean(core && (t === core || t.includes(core)));
        } catch (_) {
          return false;
        }
      });
      nodes.sort((a, b) => textOf(a).length - textOf(b).length);
      const hit = nodes[0];
      if (!hit) return { ok: false, error: "EXPECT_TAB_NOT_FOUND", want };
      clickLikeHuman(hit);
      await sleep(900);
      const after = detectSelectedJobExpect();
      return { ok: true, clicked: textOf(hit), after, want };
    } catch (e) {
      return { ok: false, error: String(e?.message || e), want };
    }
  }

  async function maybeRestoreExpectAfterLoad() {
    try {
      const want = sessionStorage.getItem("bht_restore_expect") || getSavedListCtx()?.expectLabel || "";
      if (!want) return;
      if (!isListLikePage()) return;
      for (let i = 0; i < 20; i++) {
        if (getJobCards().length >= 3) break;
        await sleep(250);
      }
      await restoreJobExpectIfNeeded(want);
      try { sessionStorage.removeItem("bht_restore_expect"); } catch (_) {}
    } catch (_) {}
  }
  try { setTimeout(() => { maybeRestoreExpectAfterLoad().catch(() => {}); }, 600); } catch (_) {}

const SELECTORS = {
    // 2026-07 真机：/web/geek/jobs
    card: [
      "ul.rec-job-list li.job-card-box",
      "li.job-card-box",
      ".job-card-wrap li.job-card-box",
      ".job-card-box",
      ".job-card-wrap",
      "li.job-card-wrapper",
      ".job-card-wrapper"
    ],
    title: ["a.job-name", ".job-name", ".job-title a", ".job-title .job-name"],
    salary: [".job-salary", ".salary", ".job-detail-info .job-salary"],
    company: [
      ".company-name",
      ".company-info .name",
      ".company-text",
      ".company-info a.name",
      ".company-info h3 a",
      ".company-info .company-name",
      ".company-card a",
      ".job-card-footer .boss-name",
      ".job-card-footer .boss-info",
      "a[ka^='company_logo_click'] .boss-name",
      "a[ka^='company_logo_click']",
      "a[ka*='job_list_company']"
    ],
    hrName: [".boss-name", ".boss-info .name", ".name-box .name", ".job-boss-info .name", ".boss-info-attr .name", ".info-public .name"],
    location: [".company-location", ".job-area", ".job-area-wrapper", ".area"],
    tags: [".tag-list li", ".job-info .tag-list li", ".job-label-list li"],
    online: [".boss-online-icon", ".boss-online-tag", ".online-tag"],
    activeText: [".boss-active-time", ".boss-info .time", ".active-time"],
    chatOnCard: ["a.op-btn-chat", ".op-btn-chat", "a.op-btn"],
    chatOnDetail: [
      "a.op-btn-chat",
      ".job-detail-op a.op-btn-chat",
      ".job-detail-box a.op-btn-chat",
      ".job-detail-header a.op-btn-chat"
    ],
    detailRoot: [".job-detail-box", ".job-detail-container", ".job-detail-header"],
    moreLink: ["a.more-job-btn", ".job-detail-box a[href*='securityId=']"],
    listScroller: [
      ".job-list-container",
      ".recommend-result-job",
      ".job-recommend-result",
      ".search-job-result",
      "#wrap"
    ],
    chatRoot: [
      ".chat-conversation",
      ".chat-box",
      ".conversation-box",
      "#chat-box",
      ".chat-container",
      ".dialog-chat",
      "[class*='chat-conversation']"
    ],
    chatInput: [
      "#chat-input",
      "div#chat-input",
      ".chat-input div[contenteditable='true']",
      ".chat-conversation div[contenteditable='true']",
      ".message-input div[contenteditable='true']",
      ".chat-editor div[contenteditable='true']",
      ".dialogue-editor div[contenteditable='true']",
      ".chat-message-input div[contenteditable='true']",
      "#boss-chat-editor",
      "[class*='chat-input'] [contenteditable='true']",
      "[class*='message-input'] [contenteditable='true']",
      "div[contenteditable='true'][data-placeholder]",
      "div[contenteditable='true'][data-slate-editor]",
      "div[contenteditable='true'][role='textbox']",
      "div.edit-area [contenteditable='true']",
      "div[contenteditable='true']",
      "textarea.input-area",
      "textarea[placeholder*='聊']",
      "textarea[placeholder*='Enter']",
      "textarea[placeholder*='发送']",
      ".chat-input textarea",
      ".message-input textarea"
    ],
    sendBtn: [".submit-button", ".send-message", ".btn-send", "[class*='send-btn']", "button.send-btn"],
    selfMsg: [
      ".message-item.item-myself .text",
      ".message-item.myself .text",
      ".item-myself .message-content",
      "[class*='myself'] .text",
      "[class*='self'] .msg-content",
      ".chat-message.mine",
      ".message-mine .text",
      ".item-myself .text"
    ]
  };

  function operationCancelledError(opId) {
    const error = new Error("任务已停止，页面操作已取消");
    error.code = "OP_CANCELLED";
    error.opId = opId || "";
    return error;
  }

  function operationStorageKey(opId) {
    return opId ? `bht_op_${opId}` : '';
  }

  async function markOperationCancelled(opId, reason = "任务已停止", settled = false) {
    const key = operationStorageKey(opId);
    if (!key) return;
    try {
      await chrome.storage.local.set({
        [key]: {
          status: "cancelled",
          opId,
          reason,
          at: Date.now(),
          settled,
          contentVersion: BHT_CONTENT_VERSION
        }
      });
    } catch (_) {}
  }

  function sleep(ms) {
    const opId = window.__BHT_ACTIVE_OP_ID__;
    if (opId && window.__BHT_OP_CANCELLED__?.[opId]) {
      return Promise.reject(operationCancelledError(opId));
    }
    return new Promise((resolve, reject) => setTimeout(() => {
      if (opId && window.__BHT_OP_CANCELLED__?.[opId]) reject(operationCancelledError(opId));
      else resolve();
    }, ms));
  }

  async function bossGreetingApi(path, options = {}) {
    const url = new URL(path, location.origin);
    if (!isBossHost(url.hostname)) throw new Error("BOSS_GREETING_BAD_ORIGIN");
    const rawZpToken = String(document.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("bst="))
      ?.slice(4) || "";
    let zpToken = rawZpToken;
    try { zpToken = decodeURIComponent(rawZpToken); } catch (_) {}
    const response = await fetch(url.href, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(zpToken ? { "zp_token": zpToken } : {}),
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error("BOSS_GREETING_HTTP_" + response.status);
    return response.json();
  }

  function normalizeBossGreetingResponse(payload) {
    const zpData = payload?.zpData || {};
    const greeting = zpData.greeting || {};
    const templates = (zpData.greetingTemplateList || []).map((item) => ({
      templateId: String(item?.templateId || ""),
      text: String(item?.demo || item?.content || "").trim(),
      category: item?.category ?? null,
      greetingType: item?.greetingType ?? null,
      editable: Number(item?.greetingType) === 2
    })).filter((item) => item.templateId || item.text);
    const templateId = String(greeting?.templateId || "");
    const current = templates.find((item) => item.templateId === templateId) || null;
    const enabled = Number(greeting?.status || 0) === 1;
    return {
      ok: true,
      enabled,
      status: enabled ? "on" : "off",
      templateId,
      text: String(current?.text || greeting?.demo || greeting?.content || "").trim(),
      templates,
      displayButton: zpData.displayButton === true || Number(zpData.displayButton) === 1,
      syncedAt: Date.now(),
      source: "boss-api"
    };
  }

  async function getBossGreetingSetting() {
    try {
      const payload = await bossGreetingApi("/wapi/zpchat/greeting/getGreetingList?_=" + Date.now());
      if (Number(payload?.code) === 7) {
        return { ok: false, error: "LOGIN_REQUIRED", message: payload?.message || "请先登录 BOSS 直聘" };
      }
      if ([120, 121, 122].includes(Number(payload?.code))) {
        return {
          ok: false,
          error: "BOSS_TOKEN_INVALID",
          code: Number(payload?.code),
          message: "BOSS 登录校验已失效（" + Number(payload?.code) + "），请刷新 BOSS 页面后重试"
        };
      }
      if (Number(payload?.code) !== 0) {
        return { ok: false, error: "BOSS_GREETING_READ_FAILED", message: payload?.message || "读取 BOSS 自动招呼设置失败" };
      }
      return normalizeBossGreetingResponse(payload);
    } catch (error) {
      return {
        ok: false,
        error: "BOSS_GREETING_READ_FAILED",
        message: "读取 BOSS 自动招呼设置失败：" + String(error?.message || error)
      };
    }
  }

  async function setBossGreetingSetting(payload = {}) {
    const enabled = payload.enabled === true;
    const before = await getBossGreetingSetting();
    if (!before.ok) return before;
    let templateId = String(payload.templateId || before.templateId || "");
    if (enabled && !templateId) templateId = String(before.templates?.[0]?.templateId || "");
    if (enabled && !templateId) {
      return {
        ok: false,
        error: "BOSS_GREETING_TEMPLATE_REQUIRED",
        message: "BOSS 当前没有可启用的招呼语模板，请先在 BOSS 设置页添加话术"
      };
    }
    try {
      const body = new URLSearchParams();
      body.set("status", enabled ? "1" : "0");
      body.set("templateId", templateId);
      const result = await bossGreetingApi("/wapi/zpchat/greeting/updateGreetingV2", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
      if ([120, 121, 122].includes(Number(result?.code))) {
        return {
          ok: false,
          error: "BOSS_TOKEN_INVALID",
          code: Number(result.code),
          message: "BOSS 登录校验已失效（" + Number(result.code) + "），请刷新 BOSS 页面后重试"
        };
      }
      if (Number(result?.code) !== 0) {
        return { ok: false, error: "BOSS_GREETING_WRITE_FAILED", message: result?.message || "修改 BOSS 自动招呼设置失败" };
      }
      await sleep(350);
      const after = await getBossGreetingSetting();
      if (!after.ok || after.enabled !== enabled) {
        return {
          ok: false,
          error: "BOSS_GREETING_WRITE_NOT_CONFIRMED",
          message: "BOSS 已响应设置请求，但回读状态不一致。请打开 BOSS 设置页确认",
          before,
          after
        };
      }
      return { ...after, changed: before.enabled !== after.enabled, previousEnabled: before.enabled };
    } catch (error) {
      return {
        ok: false,
        error: "BOSS_GREETING_WRITE_FAILED",
        message: "修改 BOSS 自动招呼设置失败：" + String(error?.message || error)
      };
    }
  }

  async function saveBossGreetingText(payload = {}) {
    const text = String(payload.text || "").trim();
    if (!text) {
      return { ok: false, error: "BOSS_GREETING_TEXT_REQUIRED", message: "请填写 BOSS 自动招呼话术" };
    }
    if (Array.from(text).length > 100) {
      return { ok: false, error: "BOSS_GREETING_TEXT_TOO_LONG", message: "BOSS 自动招呼话术最多 100 个字" };
    }
    const before = await getBossGreetingSetting();
    if (!before.ok) return before;
    const current = before.templates?.find((item) => item.templateId === before.templateId) || null;
    // BOSS 官方页面只原地编辑 greetingType=2；内置模板优先复用账号已有的自定义槽，没有才创建。
    const editableTemplate = current?.editable
      ? current
      : before.templates?.find((item) => item.editable) || null;
    const editableTemplateId = editableTemplate?.templateId || "";
    try {
      const body = new URLSearchParams();
      body.set("templateId", editableTemplateId);
      body.set("content", text);
      body.set("customType", "2");
      const saved = await bossGreetingApi("/wapi/zpchat/greeting/custom/saveV2", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
      if ([120, 121, 122].includes(Number(saved?.code))) {
        return {
          ok: false,
          error: "BOSS_TOKEN_INVALID",
          code: Number(saved.code),
          message: "BOSS 登录校验已失效（" + Number(saved.code) + "），请刷新 BOSS 页面后重试"
        };
      }
      if (Number(saved?.code) !== 0) {
        return { ok: false, error: "BOSS_GREETING_TEXT_SAVE_FAILED", message: saved?.message || "保存 BOSS 自动招呼话术失败" };
      }
      await sleep(350);
      let after = await getBossGreetingSetting();
      if (!after.ok) return after;
      const primitiveSavedId = ["string", "number"].includes(typeof saved?.zpData)
        ? saved.zpData
        : "";
      const responseTemplateId = String(
        primitiveSavedId || saved?.zpData?.templateId || saved?.zpData?.greeting?.templateId || saved?.templateId || ""
      );
      const target = after.templates?.find((item) =>
        (responseTemplateId && item.templateId === responseTemplateId) ||
        (editableTemplateId && item.templateId === editableTemplateId) ||
        (item.editable && item.text === text)
      ) || null;
      if (!target?.templateId) {
        return {
          ok: false,
          error: "BOSS_GREETING_TEXT_NOT_FOUND",
          message: "BOSS 已响应保存请求，但回读时没有找到新话术。请打开 BOSS 设置页确认"
        };
      }
      if (after.templateId !== target.templateId) {
        const selectBody = new URLSearchParams();
        selectBody.set("status", before.enabled ? "1" : "0");
        selectBody.set("templateId", target.templateId);
        const selected = await bossGreetingApi("/wapi/zpchat/greeting/updateGreetingV2", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: selectBody.toString()
        });
        if (Number(selected?.code) !== 0) {
          return {
            ok: false,
            error: "BOSS_GREETING_TEXT_SELECT_FAILED",
            message: selected?.message || "话术已保存，但设为当前 BOSS 招呼语失败"
          };
        }
        await sleep(350);
        after = await getBossGreetingSetting();
      }
      if (!after.ok || after.templateId !== target.templateId || String(after.text || "").trim() !== text) {
        return {
          ok: false,
          error: "BOSS_GREETING_TEXT_NOT_CONFIRMED",
          message: "BOSS 已响应保存请求，但当前话术回读不一致。请打开 BOSS 设置页确认",
          before,
          after
        };
      }
      return {
        ...after,
        textSaved: true,
        previousText: before.text || "",
        created: !editableTemplateId,
        savedTemplateId: target.templateId
      };
    } catch (error) {
      return {
        ok: false,
        error: "BOSS_GREETING_TEXT_SAVE_FAILED",
        message: "保存 BOSS 自动招呼话术失败：" + String(error?.message || error)
      };
    }
  }

  function findNativeGreetingReceipt(job = {}, afterTs = 0) {
    const ids = [job.jobId, job.encryptJobId].map((value) => String(value || "")).filter(Boolean);
    const rows = nativeGreetingReceipts.filter((row) => row.at >= afterTs && row.ok !== false);
    return rows.slice().reverse().find((row) => !row.jobId || !ids.length || ids.includes(row.jobId)) || null;
  }

  async function waitForNativeGreetingReceipt(job = {}, afterTs = 0, timeoutMs = 1800) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = findNativeGreetingReceipt(job, afterTs);
      if (receipt) {
        return {
          available: true,
          showGreeting: receipt.hasShowGreeting ? receipt.showGreeting : null,
          text: receipt.greeting || "",
          source: "friend-add-response",
          at: receipt.at
        };
      }
      await sleep(100);
    }
    return { available: false, showGreeting: null, text: "", source: "no-friend-add-receipt" };
  }

  function buildTriggerNavigationRecovery(inflight = {}) {
    const job = inflight?.opPayload?.job || inflight?.opPayload || {};
    const receipt = findNativeGreetingReceipt(job, Number(inflight.at || 0));
    return globalThis.BHTTriggerNavigationRecovery?.resolveTriggerNavigationRecovery?.({
      opType: inflight?.opType || "",
      triggerType: MSG.TRIGGER_CONVERSATION,
      job,
      inflightAt: Number(inflight.at || 0),
      now: Date.now(),
      click: window.__BHT_LAST_TRIGGER_CLICK__,
      receipt,
      href: location.href,
      contentVersion: BHT_CONTENT_VERSION
    }) || null;
  }

  function textOf(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  // BOSS 薪资常用私有区字体加密：尽量还原为可读数字
  function renderGlyphMatrix(ch, font, w = 24, h = 32) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#000";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = font || "16px sans-serif";
      ctx.fillText(ch, w / 2, h / 2 + 1);
      const data = ctx.getImageData(0, 0, w, h).data;
      const bin = new Uint8Array(w * h);
      let ink = 0;
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const a = data[i + 3];
        const on = a > 64 ? 1 : 0;
        bin[p] = on;
        ink += on;
      }
      if (ink < 6) return null;
      return { bin, ink, w, h };
    } catch (_) {
      return null;
    }
  }

  function matrixScore(a, b) {
    if (!a || !b || a.bin.length !== b.bin.length) return 1e15;
    let diff = 0;
    const n = a.bin.length;
    for (let i = 0; i < n; i++) diff += a.bin[i] !== b.bin[i] ? 1 : 0;
    // prefer similar ink density
    diff += Math.abs(a.ink - b.ink) * 0.15;
    return diff;
  }

  function classifyPuaDigit(ch, font) {
    // Salary glyphs are reused across every BOSS card.  Rendering the same
    // private-use glyph and all ten reference digits for every card made a
    // later scan batch grow quadratically (the 90-card continuation took
    // nearly 40 seconds in the 2026-09-01 diagnostic).  Keep a small per-page
    // cache so only genuinely new glyph/font pairs hit canvas.
    const cacheKey = String(font || "") + "\u0000" + String(ch || "");
    if (puaDigitCache.has(cacheKey)) return puaDigitCache.get(cacheKey);
    const target = renderGlyphMatrix(ch, font);
    if (!target) {
      rememberBoundedCache(puaDigitCache, cacheKey, null, 256);
      return null;
    }
    // Cross-font shape match: BOSS PUA glyphs look like digits.
    const fonts = [
      font,
      "bold 18px Arial",
      "18px Arial",
      "18px sans-serif",
      "bold 18px system-ui"
    ];
    let best = null;
    let bestScore = Infinity;
    for (const f of fonts) {
      for (let d = 0; d <= 9; d++) {
        const referenceKey = String(f) + "\u0000" + String(d);
        let ref = puaReferenceCache.get(referenceKey);
        if (!ref) {
          ref = renderGlyphMatrix(String(d), f);
          if (ref) rememberBoundedCache(puaReferenceCache, referenceKey, ref, 64);
        }
        if (!ref) continue;
        const sc = matrixScore(target, ref);
        if (sc < bestScore) {
          bestScore = sc;
          best = String(d);
        }
      }
    }
    // threshold: 24x32=768 cells; good matches usually << 220
    const result = best != null && bestScore < 260 ? best : null;
    rememberBoundedCache(puaDigitCache, cacheKey, result, 256);
    return result;
  }

  // These caches intentionally live only for the current content document;
  // a BOSS navigation creates a fresh script instance and cannot retain stale
  // font or DOM assumptions.
  const puaDigitCache = new Map();
  const puaReferenceCache = new Map();
  const salaryTextCache = new Map();
  function rememberBoundedCache(cache, key, value, limit = 512) {
    cache.set(key, value);
    if (cache.size > limit) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  }

  function decodeBossSalaryText(raw, salaryEl) {
    const s = String(raw || "").replace(/\s+/g, "");
    if (!s) return "";
    if (/[0-9]/.test(s) && !/[\uE000-\uF8FF]/.test(s)) return s;

    const chars = Array.from(s);
    const puaList = [...new Set(chars.filter((ch) => {
      const cp = ch.codePointAt(0);
      return cp >= 0xe000 && cp <= 0xf8ff;
    }))];
    if (!puaList.length) return s;

    const digitMap = {};
    let font = "16px sans-serif";
    try {
      if (salaryEl) font = window.getComputedStyle(salaryEl).font || font;
    } catch (_) {}

    const cacheKey = String(font) + "\u0000" + s;
    if (salaryTextCache.has(cacheKey)) return salaryTextCache.get(cacheKey);

    // A) canvas shape classify (most reliable when font available)
    for (const ch of puaList) {
      const d = classifyPuaDigit(ch, font);
      if (d != null) digitMap[ch] = d;
    }

    // B) low-byte ASCII digit style: U+xx30..U+xx39
    for (const ch of puaList) {
      if (digitMap[ch] != null) continue;
      const low = ch.codePointAt(0) & 0xff;
      if (low >= 0x30 && low <= 0x39) digitMap[ch] = String(low - 0x30);
    }

    // C) contiguous PUA block: if we saw 10 unique, map sorted -> 0-9
    if (puaList.length === 10) {
      const sorted = [...puaList].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
      const allMapped = sorted.every((ch) => digitMap[ch] != null);
      if (!allMapped) {
        sorted.forEach((ch, i) => { digitMap[ch] = String(i); });
      }
    }

    // D) if still sparse: use relative order of observed PUA only when count>=8
    const unmapped = puaList.filter((ch) => digitMap[ch] == null);
    if (unmapped.length && puaList.length >= 8) {
      const sorted = [...puaList].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
      sorted.forEach((ch, i) => {
        if (digitMap[ch] == null) digitMap[ch] = String(i % 10);
      });
    }

    const decoded = chars.map((ch) => (digitMap[ch] != null ? digitMap[ch] : ch)).join("");
    const result = /[0-9]/.test(decoded) ? decoded : s.replace(/[\uE000-\uF8FF]/g, "?");
    rememberBoundedCache(salaryTextCache, cacheKey, result, 512);
    return result;
  }

  function extractSalaryFromComponent(card) {
    // try react/vue internals for clear salaryDesc
    const nodes = [card, card?.firstElementChild, card?.querySelector?.(".job-salary")].filter(Boolean);
    for (const node of nodes) {
      try {
        const keys = Object.keys(node || {});
        for (const k of keys) {
          if (!/^__(reactFiber|reactInternalInstance|vueParentComponent|vue__)/.test(k) && k !== "__vueParentComponent" && k !== "__vue__") continue;
          let cur = node[k];
          for (let depth = 0; depth < 12 && cur; depth++) {
            const props = cur.memoizedProps || cur.pendingProps || cur.props || cur.data || null;
            const cand = [
              props?.salaryDesc,
              props?.salary,
              props?.jobSalary,
              props?.data?.salaryDesc,
              props?.data?.salary,
              props?.job?.salaryDesc,
              props?.job?.salary,
              cur?.ctx?.salaryDesc
            ].filter(Boolean);
            for (const c of cand) {
              const t = String(c).replace(/\s+/g, "");
              if (/[0-9]/.test(t) && !/[\uE000-\uF8FF]/.test(t)) return t;
            }
            cur = cur.return || cur.parent || cur._ || null;
          }
        }
      } catch (_) {}
    }
    return "";
  }

  function extractJobMetadataFromComponent(card) {
    const nodes = [card, card?.firstElementChild, card?.querySelector?.("a.job-name")].filter(Boolean);
    for (const node of nodes) {
      try {
        for (const key of Object.keys(node || {})) {
          if (!/^__(reactFiber|reactInternalInstance|vueParentComponent|vue__)/.test(key) && key !== "__vueParentComponent" && key !== "__vue__") continue;
          let cur = node[key];
          for (let depth = 0; depth < 12 && cur; depth++) {
            const props = cur.memoizedProps || cur.pendingProps || cur.props || cur.$props || cur.data || cur.ctx || null;
            const candidates = [
              props?.data,
              props?.job,
              props?.jobInfo,
              props?.item,
              props,
              cur?.data,
              cur?.ctx?.data,
              cur?.ctx?.job,
              cur?.ctx?.jobInfo
            ].filter((value) => value && typeof value === "object");
            for (const value of candidates) {
              const jobInfo = value.jobInfo || {};
              const bossInfo = value.bossInfo || {};
              const jobId = String(value.encryptJobId || value.encryptId || value.jobId || jobInfo.encryptId || "");
              const securityId = String(value.securityId || "");
              const lid = String(value.lid || "");
              if (!jobId && !securityId && !lid) continue;
              const bossOnline = value.bossOnline === true || value.bossOnline === 1 || bossInfo.bossOnline === true || bossInfo.bossOnline === 1;
              return {
                jobId,
                securityId,
                lid,
                bossId: String(value.encryptBossId || value.bossId || bossInfo.encryptBossId || ""),
                bossName: String(value.bossName || bossInfo.name || "").trim(),
                bossTitle: String(value.bossTitle || bossInfo.title || "").trim(),
                brandName: String(value.brandName || bossInfo.brandName || "").trim(),
                bossOnline,
                goldHunter: value.goldHunter === true || value.goldHunter === 1 || bossInfo.goldHunter === 1,
                activeText: bossOnline ? "在线" : String(value.activeTimeDesc || bossInfo.activeTimeDesc || "").trim()
              };
            }
            cur = cur.return || cur.parent || cur._ || cur.$parent || null;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  function extractSalary(card, salaryEl) {
    // 1) data / aria
    const attrCandidates = [
      salaryEl?.getAttribute?.("data-salary"),
      salaryEl?.dataset?.salary,
      card?.getAttribute?.("data-salary"),
      card?.dataset?.salary,
      card?.getAttribute?.("data-salary-desc"),
      salaryEl?.getAttribute?.("aria-label"),
      salaryEl?.getAttribute?.("title"),
      salaryEl?.getAttribute?.("data-v")
    ].filter(Boolean);
    for (const a of attrCandidates) {
      const t = String(a).replace(/\s+/g, "");
      if (/[0-9]/.test(t) && !/[\uE000-\uF8FF]/.test(t)) return t;
    }

    // 2) component props (clear text)
    const fromComp = extractSalaryFromComponent(card);
    if (fromComp) return fromComp;

    // 3) normal digits
    const raw = textOf(salaryEl);
    if (/[0-9]/.test(raw) && !/[\uE000-\uF8FF]/.test(raw)) return raw.replace(/\s+/g, " ").trim();

    // 4) decode PUA via canvas/font
    const decoded = decodeBossSalaryText(raw, salaryEl);
    if (/[0-9]/.test(decoded) && !/[?]/.test(decoded.replace(/[^0-9?]/g, ""))) {
      // keep units from original if decoded dropped them
      const unit = (raw.match(/[元万Kk千]\/?[天月年]?|\/[天月年]/) || [])[0] || "";
      if (unit && !decoded.includes(unit[0])) return decoded + unit;
      return decoded;
    }
    if (/[0-9]/.test(decoded)) return decoded;

    // 5) card full text fallback
    const full = textOf(card);
    const m =
      full.match(/(\d{1,4}\s*[-~～—]\s*\d{1,4}\s*[Kk千]?\.?\d*\s*[元万]?\/?[天月年]?)/) ||
      full.match(/(\d{1,4}\s*[-~～—]\s*\d{1,4}\s*元\/天)/) ||
      full.match(/(\d{1,3}\s*[-~～—]\s*\d{1,3}\s*[Kk])/);
    if (m) return m[1].replace(/\s+/g, "");

    return decoded || raw || "";
  }


function firstEl(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function allEl(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const list = Array.from(root.querySelectorAll(sel));
        if (list.length) return list;
      } catch (_) {}
    }
    return [];
  }

  function installJobNavGuard(ms = 20000) {
    const blocker = (e) => {
      try {
        const t = e.target;
        const a = t && t.closest ? t.closest("a[href], area[href]") : null;
        if (!a) return;
        const href = a.href || a.getAttribute("href") || "";
        // 拦截岗位详情整页跳转，保留列表 SPA（求职期望/筛选状态）
        if (/job_detail|geek\/job|\/job\//i.test(href) && !/web\/geek\/jobs/i.test(href)) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        }
      } catch (_) {}
    };
    document.addEventListener("click", blocker, true);
    document.addEventListener("auxclick", blocker, true);
    document.addEventListener("mousedown", blocker, true);
    const timer = setTimeout(() => {
      try { document.removeEventListener("click", blocker, true); } catch (_) {}
      try { document.removeEventListener("auxclick", blocker, true); } catch (_) {}
      try { document.removeEventListener("mousedown", blocker, true); } catch (_) {}
    }, ms);
    return () => {
      clearTimeout(timer);
      try { document.removeEventListener("click", blocker, true); } catch (_) {}
      try { document.removeEventListener("auxclick", blocker, true); } catch (_) {}
      try { document.removeEventListener("mousedown", blocker, true); } catch (_) {}
    };
  }

  function preventLinkNavigation(root, ms = 600) {
    try {
      const scope = root && root.querySelectorAll ? root : document;
      const anchors = Array.from(scope.querySelectorAll("a[href], a.job-name"))
        .filter((a) => a && typeof a.addEventListener === "function");
      const onClick = (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) {}
      };
      anchors.forEach((a) => {
        try { a.addEventListener("click", onClick, true); } catch (_) {}
      });
      setTimeout(() => {
        anchors.forEach((a) => {
          try { a.removeEventListener("click", onClick, true); } catch (_) {}
        });
      }, ms);
      return anchors.length;
    } catch (_) {
      return 0;
    }
  }

  function clickLikeHuman(el) {
    if (!el) {
      debugTrace("click_skipped_missing_element", {}, "warn");
      return false;
    }
    const clickId = "click_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
    const element = describeDebugElement(el);
    debugTrace("click_attempt", {
      clickId,
      element,
      caller: String(new Error().stack || "").split("\n").slice(1, 6).join("\n")
    });
    try {
      el.scrollIntoView({ block: "center", behavior: "instant" });
      debugTrace("click_scrolled_into_view", { clickId, element: describeDebugElement(el) });
    } catch (error) {
      debugTrace("click_scroll_error", { clickId, error: serializeDebugError(error), element }, "warn");
    }
    const opts = { bubbles: true, cancelable: true, view: window };
    const dispatched = [];
    let fallback = false;
    try {
      for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
        const accepted = el.dispatchEvent(new MouseEvent(type, opts));
        dispatched.push({ type, accepted });
      }
    } catch (error) {
      debugTrace("click_dispatch_error", { clickId, error: serializeDebugError(error), dispatched, element }, "warn");
      try {
        fallback = true;
        el.click();
      } catch (fallbackError) {
        debugTrace("click_fallback_error", {
          clickId,
          error: serializeDebugError(fallbackError),
          element: describeDebugElement(el)
        }, "error");
        return false;
      }
    }
    debugTrace("click_dispatched", {
      clickId,
      dispatched,
      fallback,
      element: describeDebugElement(el),
      activeElement: describeDebugElement(document.activeElement)
    });
    setTimeout(() => {
      debugTrace("click_after_state", {
        clickId,
        element: describeDebugElement(el),
        activeElement: describeDebugElement(document.activeElement),
        documentReadyState: document.readyState
      });
    }, 0);
    return true;
  }

  function normalizeText(input = "") {
    return String(input || "")
      .normalize("NFKC")
      .replace(/【[^】]*】/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/[\uE000-\uF8FF]/g, "")
      .replace(/[^\p{L}\p{N}+#]+/gu, "")
      .toLowerCase();
  }

      function coreTitle(input = "") {
    // strip city/paren suffixes
    return normalizeText(
      String(input || "")
        .replace(/（[^）]*）/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/【[^】]*】/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/[-—–·][\u4e00-\u9fa5A-Za-z0-9/／、]{1,20}$/g, "")
    );
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function safeDecode(s) {
    try {
      if (typeof decodeURIComponent === "function") return decodeURIComponent(s);
    } catch (_) {}
    try {
      return unescape(s);
    } catch (_) {}
    return String(s || "");
  }

  function absolutizeHref(href = "") {
    const h = String(href || "").trim();
    if (!h || h === "#" || /^javascript:/i.test(h)) return "";
    try { return new URL(h, location.origin).href; } catch (_) { return h; }
  }

  function extractJobIdFromHref(href = "") {
    if (!href) return "";
    const m1 = String(href).match(/job_detail\/([^~.?\s/]+)/i);
    if (m1) return safeDecode(m1[1].replace(/\.html$/i, ""));
    const m2 = String(href).match(/[?&](?:jobId|jid)=([^&]+)/i);
    if (m2) return safeDecode(m2[1]);
    return "";
  }

  function extractSecurityId(href = "") {
    const m = String(href).match(/[?&]securityId=([^&]+)/);
    return m ? safeDecode(m[1]) : "";
  }

  function getJobCards() {
    const preferred = [
      "ul.rec-job-list li.job-card-box",
      ".job-list-container ul li.job-card-box",
      ".job-list-container li.job-card-box",
      ".job-recommend-result li.job-card-box",
      ".search-job-result li.job-card-box",
      ".recommend-result-job li.job-card-box",
      "li.job-card-box",
      ".job-card-box"
    ];
    let cards = [];
    for (const sel of preferred) {
      try {
        const list = Array.from(document.querySelectorAll(sel)).filter((el) => {
          // 排除详情区、侧栏推荐、聊天区
          if (el.closest(".job-detail-box, .job-detail-container, .chat-container, .chat-box, .dialog-chat")) return false;
          // 排除明显非主列表的小卡片区
          const root = el.closest("ul, ol, .job-list, .job-list-container, .rec-job-list, .search-job-result");
          if (root && root.querySelectorAll("li.job-card-box, .job-card-box").length < 3 && cards.length === 0) {
            // still allow if only few cards on page
          }
          return true;
        });
        if (list.length) { cards = list; break; }
      } catch (_) {}
    }
    if (!cards.length) {
      cards = Array.from(document.querySelectorAll("a.job-name"))
        .map((a) => {
          if (a.closest(".job-detail-box, .job-detail-container, .chat-container, .chat-box")) return null;
          return a.closest("li.job-card-box") || a.closest(".job-card-box") || a.closest(".job-card-wrap") || a.closest("li") || a.parentElement;
        })
        .filter(Boolean);
    }
    const uniq = [];
    const seen = new Set();
    for (const card of cards) {
      if (!card || seen.has(card)) continue;
      if (card.closest?.(".job-detail-box, .job-detail-container")) continue;
      const titleEl = card.querySelector?.("a.job-name, .job-name") || (card.matches?.("a.job-name") ? card : null);
      if (!titleEl || textOf(titleEl).length < 2) continue;
      seen.add(card);
      uniq.push(card);
    }
    return uniq;
  }

  function parseJobCard(card, index) {
    const scope = card.closest?.(".job-card-wrap, .job-card-wrapper") || card;
    const titleEl = firstEl(SELECTORS.title, card);
    const salaryEl = firstEl(SELECTORS.salary, card);
    const companyEl = firstEl(SELECTORS.company, scope);
    const locationEl = firstEl(SELECTORS.location, card);
    const activeEl = firstEl(SELECTORS.activeText, card);
    const tags = allEl(SELECTORS.tags, card).map(textOf).filter(Boolean).slice(0, 12);
    const componentMeta = extractJobMetadataFromComponent(card) || {};

    const linkEl =
      (titleEl && titleEl.tagName === "A" ? titleEl : null) ||
      titleEl?.closest?.("a") ||
      firstEl(["a[href*='job_detail']", "a[href*='job']"], card);

    let href = absolutizeHref(linkEl?.href || linkEl?.getAttribute?.("href") || "");
    // 卡片 data 属性兜底拼详情 URL
    if (!href) {
      const enc =
        card.getAttribute?.("data-jobid") ||
        card.getAttribute?.("data-job-id") ||
        card.dataset?.jobid ||
        card.dataset?.jid ||
        "";
      if (enc) href = absolutizeHref("/job_detail/" + enc + ".html");
    }
    let jobId =
      card.getAttribute?.("data-jobid") ||
      card.getAttribute?.("data-job-id") ||
      card.getAttribute?.("data-jid") ||
      card.dataset?.jobid ||
      card.dataset?.jid ||
      linkEl?.getAttribute?.("data-jobid") ||
      linkEl?.getAttribute?.("data-jid") ||
      extractJobIdFromHref(href) ||
      componentMeta.jobId ||
      "";

    const networkMeta = jobNetworkMetadata.get(String(jobId || '')) || {};
    if (!href && jobId) href = absolutizeHref("/job_detail/" + jobId + ".html");

    // securityId 可能在详情 more link，卡片阶段先空
    let securityId = extractSecurityId(href) || networkMeta.securityId || componentMeta.securityId || "";
    const lid = String(networkMeta.lid || componentMeta.lid || "");

    const bossId =
      card.getAttribute?.("data-uid") ||
      card.getAttribute?.("data-bossid") ||
      card.getAttribute?.("data-boss-id") ||
      networkMeta.bossId ||
      componentMeta.bossId ||
      "";

    // 列表卡上通常没有沟通按钮，沟通在右侧详情
    let btn =
      firstEl(SELECTORS.chatOnCard, card) ||
      Array.from(card.querySelectorAll("a,button")).find((el) =>
        /立即沟通|继续沟通|打招呼/.test(textOf(el))
      );

    const btnText = textOf(btn);
    const communicated = /继续沟通|沟通中/.test(btnText);
    const title = textOf(titleEl) || textOf(card).slice(0, 40);
    const company = textOf(companyEl) || networkMeta.brandName || componentMeta.brandName || "";
    const salary = extractSalary(card, salaryEl);
    const locationText = textOf(locationEl);
    const online = Boolean(
      firstEl(SELECTORS.online, card) ||
      networkMeta.bossOnline === true ||
      componentMeta.bossOnline === true
    );
    const activeText = textOf(activeEl) || networkMeta.activeText || componentMeta.activeText || (online ? "在线" : "");
    const jd = [textOf(card), tags.join(" ")].join(" ");

    if (!jobId) {
      const stable = hashStr(normalizeText(title) + "|" + normalizeText(company));
      jobId = (title || company) ? ("name_" + stable) : ("dom_" + index + "_" + stable);
    }

    return {
      index,
      jobId,
      securityId,
      lid,
      bossId,
      title,
      company,
      salary,
      location: locationText,
      activeText,
      goldHunter: networkMeta.goldHunter === true || componentMeta.goldHunter === true,
      hrTitle: String(networkMeta.bossTitle || componentMeta.bossTitle || "").trim(),
      tags,
      jd,
      href: href.startsWith("http") ? href : href ? new URL(href, globalThis.location.origin).href : "",
      communicated,
      hasChat: communicated,
      canCommunicate: true,
      buttonText: btnText,
      hrName: (() => {
        try {
          // 当前 BOSS 列表卡中的 .boss-info/.boss-name 是公司，不是招聘者；
          // 列表没有明确招聘者节点时保持为空，等右侧详情区读取 .job-boss-info .name。
          let hr = textOf(firstEl([
            ".recruiter-info .recruiter-name",
            ".recruiter-name",
            ".hr-name",
            "[data-role='recruiter-name']"
          ], scope)) || networkMeta.bossName || componentMeta.bossName || "";
          hr = globalThis.BHTConversationMatch?.cleanHrIdentity
            ? globalThis.BHTConversationMatch.cleanHrIdentity(hr)
            : String(hr || "").split(/[·|｜]/)[0].replace(/\s+/g, " ").trim();
          if (hr && company && normalizeText(hr) === normalizeText(company)) hr = "";
          return hr;
        } catch (_) { return ""; }
      })(),
      online
    };
  }

  async function autoScrollList(maxRounds = 8) {
    const scroller =
      firstEl(SELECTORS.listScroller) || document.scrollingElement || document.documentElement;
    let lastCount = 0;
    for (let i = 0; i < maxRounds; i++) {
      const cards = getJobCards();
      if (cards.length && cards.length === lastCount && i > 2) break;
      lastCount = cards.length;
      const last = cards[cards.length - 1];
      try {
        last?.scrollIntoView({ block: "end", behavior: "instant" });
      } catch (_) {}
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      window.scrollBy(0, 900);
      await sleep(500);
    }
  }

  function getAdaptiveScanScroller() {
    const candidates = [];
    for (const selector of SELECTORS.listScroller || []) {
      try { candidates.push(...document.querySelectorAll(selector)); } catch (_) {}
    }
    candidates.push(document.scrollingElement, document.documentElement, document.body);
    for (const el of candidates.filter(Boolean)) {
      try {
        const isDocumentScroller = el === document.scrollingElement || el === document.documentElement || el === document.body;
        const style = getComputedStyle(el);
        const scrollableStyle = /auto|scroll|overlay/i.test(style.overflowY || '');
        if (el.scrollHeight > el.clientHeight + 80 && (isDocumentScroller || scrollableStyle)) return el;
      } catch (_) {}
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollListToTop() {
    const apply = () => {
      try {
        const scroller = getAdaptiveScanScroller();
        if (
          scroller &&
          scroller !== document.scrollingElement &&
          scroller !== document.documentElement &&
          scroller !== document.body
        ) {
          scroller.scrollTop = 0;
        }
        window.scrollTo(0, 0);
      } catch (_) {}
    };
    const read = () => {
      const scroller = getAdaptiveScanScroller();
      const isDoc = scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
      return {
        containerTop: scroller && !isDoc ? Number(scroller.scrollTop || 0) : 0,
        windowTop: Number(window.scrollY || 0)
      };
    };
    apply();
    // BOSS SPA 会在列表就绪后异步恢复滚动位置，稍后补一次确保停在顶部
    setTimeout(apply, 400);
    return { ok: true, ...read() };
  }

  function describeAdaptiveScanScroller(scroller) {
    const isDocumentScroller =
      scroller === document.scrollingElement ||
      scroller === document.documentElement ||
      scroller === document.body;
    let overflowY = '';
    try { overflowY = String(getComputedStyle(scroller).overflowY || ''); } catch (_) {}
    return {
      kind: isDocumentScroller ? 'document' : 'element',
      tag: String(scroller?.tagName || ''),
      id: String(scroller?.id || ''),
      className: String(scroller?.className || '').slice(0, 160),
      overflowY
    };
  }

  function adaptiveScrollSnapshot(scroller) {
    const isDocumentScroller =
      scroller === document.scrollingElement ||
      scroller === document.documentElement ||
      scroller === document.body;
    const top = isDocumentScroller ? window.scrollY : Number(scroller?.scrollTop || 0);
    const viewport = isDocumentScroller ? window.innerHeight : Number(scroller?.clientHeight || 0);
    const height = isDocumentScroller
      ? Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0)
      : Number(scroller?.scrollHeight || 0);
    return {
      top,
      viewport,
      height,
      atBottom: height > 0 && top + viewport >= height - 48
    };
  }

  function setAdaptiveScrollTop(scroller, top) {
    const nextTop = Math.max(0, Number(top || 0));
    const isDocumentScroller =
      scroller === document.scrollingElement ||
      scroller === document.documentElement ||
      scroller === document.body;
    if (isDocumentScroller) window.scrollTo(0, nextTop);
    else scroller.scrollTop = nextTop;
  }

  function nextAdaptiveScrollTop(snapshot) {
    const viewport = Math.max(1, Number(snapshot?.viewport || 0));
    const maxTop = Math.max(0, Number(snapshot?.height || 0) - viewport);
    // 85% 视口步进保留重叠窗口：append-only 列表仍然很快，虚拟列表也不会
    // 因为直接从顶部跳到尾部而漏掉中间岗位。
    const step = Math.max(240, Math.floor(viewport * 0.85));
    return Math.min(maxTop, Math.max(0, Number(snapshot?.top || 0)) + step);
  }

  function pulseAdaptiveScrollBottom(scroller, snapshot) {
    const viewport = Math.max(1, Number(snapshot?.viewport || 0));
    const maxTop = Math.max(0, Number(snapshot?.height || 0) - viewport);
    const pullback = Math.max(80, Math.min(180, Math.floor(viewport * 0.16)));
    setAdaptiveScrollTop(scroller, Math.max(0, maxTop - pullback));
    // 两次不同 scrollTop 会重新触发只监听 scroll 事件的懒加载器。
    setAdaptiveScrollTop(scroller, maxTop);
  }

  function hasExplicitJobListEnd(scroller) {
    const root = scroller?.querySelector ? scroller : document;
    try {
      const marker = root.querySelector(
        ".loadmore-end, .load-more-end, .list-end, .job-list-end, [data-list-end='true'], [data-has-more='false']"
      );
      if (marker) return true;
      const tail = String(root.textContent || '').replace(/\s+/g, ' ').trim().slice(-160);
      return /没有更多(?:职位|岗位)?|暂无更多(?:职位|岗位)?|已加载全部/.test(tail);
    } catch (_) {
      return false;
    }
  }

  function collectAdaptiveScanJobs(session) {
    const cards = getJobCards();
    // BOSS keeps already loaded cards in the DOM while appending the next
    // result page.  Re-parsing every card on every scroll round made the scan
    // O(n^2), and the encrypted salary decoder amplified that cost with many
    // canvas renders.  Cache by DOM node plus a cheap identity fingerprint;
    // virtualized lists that recycle a node are still re-parsed when its job
    // id, link, title, activity or button changes.
    const cardCache = session.cardCache || (session.cardCache = new WeakMap());
    const cardIdentity = (card) => {
      try {
        const id = String(
          card.getAttribute?.("data-jobid") ||
          card.getAttribute?.("data-job-id") ||
          card.getAttribute?.("data-jid") ||
          card.dataset?.jobid ||
          card.dataset?.jid ||
          ""
        );
        const link = card.querySelector?.("a.job-name[href], a[href*='job_detail'], a[href*='jobId='], a[href*='jid=']");
        const href = String(link?.getAttribute?.("href") || link?.href || "");
        const metadataId = id || extractJobIdFromHref(href);
        const metadata = jobNetworkMetadata.get(String(metadataId || '')) || {};
        const title = String(card.querySelector?.("a.job-name, .job-name")?.textContent || "")
          .replace(/\s+/g, " ").trim();
        const active = String(card.querySelector?.(".boss-active-time, .boss-info .time, .active-time")?.textContent || "")
          .replace(/\s+/g, " ").trim();
        const button = String(card.querySelector?.("a.op-btn-chat, .op-btn-chat, a.op-btn")?.textContent || "")
          .replace(/\s+/g, " ").trim();
        return [
          id,
          href,
          title,
          active,
          button,
          metadata.securityId || '',
          metadata.lid || '',
          metadata.activeText || '',
          metadata.bossOnline === true ? '1' : '0'
        ].join("\u0001");
      } catch (_) {
        return "";
      }
    };
    const visibleKeys = [];
    const newJobs = [];
    let added = 0;
    cards.forEach((card, index) => {
      const identity = cardIdentity(card);
      const cached = cardCache.get(card);
      let job = cached && cached.identity === identity ? cached.job : null;
      if (!job) {
        job = parseJobCard(card, index);
        cardCache.set(card, { identity, job });
      }
      const key = String(job.jobId || `${normalizeText(job.title || '')}|${normalizeText(job.company || '')}`);
      if (!key) return;
      visibleKeys.push(key);
      const previous = session.jobs.get(key);
      const merged = {
        ...(previous || {}),
        ...job,
        company: job.company || previous?.company || '',
        href: job.href || previous?.href || '',
        securityId: job.securityId || previous?.securityId || '',
        lid: job.lid || previous?.lid || '',
        bossId: job.bossId || previous?.bossId || '',
        hrName: job.hrName || previous?.hrName || '',
        activeText: job.activeText || previous?.activeText || '',
        index: previous?.index ?? session.jobs.size
      };
      if (!previous) {
        added += 1;
        newJobs.push(merged);
      }
      session.jobs.set(key, merged);
    });
    return {
      added,
      newJobs,
      visibleCount: cards.length,
      signature: visibleKeys.join('|')
    };
  }

  async function scanAdaptiveJobBatch(payload = {}) {
    const sessionId = String(payload.scanSessionId || 'default');
    let session = window.__BHT_SCAN_SESSION__;
    if (payload.resetSession === true || !session || session.id !== sessionId) {
      session = window.__BHT_SCAN_SESSION__ = {
        id: sessionId,
        jobs: new Map(),
        cardCache: new WeakMap(),
        rounds: 0,
        stableRounds: 0,
        bottomStableRounds: 0,
        reachedEnd: false,
        startedAt: Date.now(),
        lastGrowthAt: Date.now(),
        growthEvents: 0,
        initialScrollTop: null,
        initialScrollHeight: null,
        scanStartTop: null,
        lastSignature: ''
      };
    }

    let scroller = session.scroller?.isConnected
      ? session.scroller
      : getAdaptiveScanScroller();
    session.scroller = scroller;
    const initialSnapshot = adaptiveScrollSnapshot(scroller);
    if (session.initialScrollTop == null) session.initialScrollTop = initialSnapshot.top;
    if (session.initialScrollHeight == null) session.initialScrollHeight = initialSnapshot.height;
    const batchJobs = new Map();
    let batchAdded = 0;
    let lastVisibleCount = 0;
    let lastSignature = '';
    const deadlineAt = Math.max(0, Number(payload.deadlineAt || 0));
    let timedOut = false;
    let lastProgressAt = 0;
    const reportScanProgress = (count) => {
      const now = Date.now();
      if (now - lastProgressAt < 250) return;
      lastProgressAt = now;
      try {
        chrome.runtime.sendMessage({
          type: MSG.SCAN_PROGRESS,
          payload: { count: Number(count || 0), at: now }
        }).catch(() => {});
      } catch (_) {}
    };
    const collectWindow = () => {
      const sizeBefore = session.jobs.size;
      const collected = collectAdaptiveScanJobs(session);
      for (const job of collected.newJobs) {
        batchJobs.set(String(job.jobId || `${normalizeText(job.title)}|${normalizeText(job.company)}`), job);
      }
      batchAdded += collected.added;
      lastVisibleCount = collected.visibleCount;
      lastSignature = collected.signature;
      if (collected.added > 0 && sizeBefore > 0) {
        session.lastGrowthAt = Date.now();
        session.growthEvents += 1;
      }
      reportScanProgress(session.jobs.size);
      return collected;
    };
    const isScanStopError = (error) => error?.code === "OP_CANCELLED";
    const sleepUntilScanStop = async (ms) => {
      const remainingMs = deadlineAt ? Math.max(0, deadlineAt - Date.now()) : ms;
      if (deadlineAt && remainingMs <= 0) {
        timedOut = true;
        return;
      }
      try {
        await sleep(Math.min(ms, remainingMs));
      } catch (error) {
        if (isScanStopError(error)) {
          timedOut = true;
          return;
        }
        throw error;
      }
      if (deadlineAt && Date.now() >= deadlineAt) timedOut = true;
    };

    try {
    // Preserve the current virtual window before returning to the top. BOSS
    // currently appends cards, but this also covers a future recycled list.
    collectWindow();
    if (payload.resetSession === true && initialSnapshot.top > 8) {
      try {
        setAdaptiveScrollTop(scroller, 0);
        let topStableRounds = 0;
        let previousTopSignature = '';
        for (let attempt = 0; attempt < 6; attempt++) {
          if (deadlineAt && Date.now() >= deadlineAt) {
            timedOut = true;
            break;
          }
          await sleepUntilScanStop(80);
          scroller = session.scroller?.isConnected
            ? session.scroller
            : getAdaptiveScanScroller();
          session.scroller = scroller;
          const topWindow = collectWindow();
          const topSnapshot = adaptiveScrollSnapshot(scroller);
          if (topSnapshot.top <= 8 && topWindow.signature === previousTopSignature) topStableRounds += 1;
          else topStableRounds = 0;
          previousTopSignature = topWindow.signature;
          if (topStableRounds >= 2 || timedOut) break;
          if (topSnapshot.top > 8) setAdaptiveScrollTop(scroller, 0);
        }
      } catch (error) {
        if (!isScanStopError(error)) throw error;
        timedOut = true;
      }
    }
    if (session.scanStartTop == null) session.scanStartTop = adaptiveScrollSnapshot(scroller).top;
    const requestedRounds = Number(payload.maxRounds);
    const continuous = payload.continuous === true;
    // A preview normally owns one content operation for the whole collection
    // window.  Do not cap that operation at the old eight-round batch; the
    // shared deadline below is the real stop condition.  Keep a generous
    // iteration guard for pages that never report a usable bottom.
    const maxRounds = payload.scroll === false
      ? 0
      : continuous
        ? Math.max(1, Math.min(512, Number.isFinite(requestedRounds) ? requestedRounds : 512))
        : Math.max(1, Math.min(64, Number.isFinite(requestedRounds) ? requestedRounds : 24));
    const requestedWaitMs = Number(payload.scrollWaitMs);
    const waitMs = Math.max(70, Math.min(500, Number.isFinite(requestedWaitMs) ? requestedWaitMs : 100));
    const bottomWaitMs = Math.max(260, Math.min(600, waitMs * 3));

    for (let round = 0; round < maxRounds && !session.reachedEnd; round++) {
      if (timedOut || (deadlineAt && Date.now() >= deadlineAt)) {
        timedOut = true;
        break;
      }
      scroller = session.scroller?.isConnected
        ? session.scroller
        : getAdaptiveScanScroller();
      session.scroller = scroller;
      const before = adaptiveScrollSnapshot(scroller);
      try {
        if (before.atBottom) pulseAdaptiveScrollBottom(scroller, before);
        else setAdaptiveScrollTop(scroller, nextAdaptiveScrollTop(before));
      } catch (_) {}
      const settleMs = before.atBottom ? bottomWaitMs : waitMs;
      await sleepUntilScanStop(settleMs);

      scroller = session.scroller?.isConnected
        ? session.scroller
        : getAdaptiveScanScroller();
      session.scroller = scroller;
      const previousSignature = lastSignature;
      const collected = collectWindow();
      const after = adaptiveScrollSnapshot(scroller);
      const moved = Math.abs(after.top - before.top) > 8 || after.height !== before.height;
      const visibleChanged = Boolean(collected.signature && collected.signature !== previousSignature);
      session.rounds += 1;
      if (deadlineAt && Date.now() >= deadlineAt) timedOut = true;

      if (collected.added <= 0 && !moved && !visibleChanged) session.stableRounds += 1;
      else session.stableRounds = 0;
      // 虚拟列表替换节点时可能短暂没有卡片；空 DOM 不能作为“到底”证据。
      if (after.atBottom && collected.visibleCount > 0 && collected.added <= 0 && !visibleChanged) session.bottomStableRounds += 1;
      else session.bottomStableRounds = 0;
      const explicitEnd = after.atBottom && hasExplicitJobListEnd(scroller);
      if (
        !timedOut &&
        (
          explicitEnd ||
          (session.bottomStableRounds >= 8 && Date.now() - session.lastGrowthAt >= 3000)
        )
      ) {
        session.reachedEnd = true;
      }
      if (timedOut) break;
    }
    } catch (error) {
      if (!isScanStopError(error)) throw error;
      timedOut = true;
      try { collectWindow(); } catch (_) {}
    }

    if (!session.reachedEnd && deadlineAt && Date.now() >= deadlineAt) timedOut = true;
    if (timedOut) session.reachedEnd = false;
    session.lastSignature = lastSignature;
    const snapshot = adaptiveScrollSnapshot(scroller);
    // timedOut 表示采集在 deadlineAt 截止；随后仅允许构造快照和写回结果。
    const collectionFinishedAt = timedOut && deadlineAt ? deadlineAt : Date.now();
    const scrollerInfo = describeAdaptiveScanScroller(scroller);
    const allJobs = Array.from(session.jobs.values()).map((job, index) => ({ ...job, index }));
    const jobs = payload.deltaOnly === true
      ? Array.from(batchJobs.values())
      : allJobs;
    return {
      jobs,
      count: allJobs.length,
      scanMeta: {
        sessionId,
        uniqueCount: allJobs.length,
        returnedCount: jobs.length,
        visibleCount: lastVisibleCount,
        batchAdded,
        rounds: session.rounds,
        reachedEnd: session.reachedEnd,
        timedOut,
        atBottom: snapshot.atBottom,
        stableRounds: session.stableRounds,
        bottomStableRounds: session.bottomStableRounds,
        growthEvents: session.growthEvents,
        initialScrollTop: session.initialScrollTop,
        initialScrollHeight: session.initialScrollHeight,
        scanStartTop: session.scanStartTop,
        scrollTop: snapshot.top,
        scrollHeight: snapshot.height,
        scrollViewport: snapshot.viewport,
        scroller: scrollerInfo,
        lastGrowthAgoMs: Math.max(0, Date.now() - session.lastGrowthAt),
        collectionFinishedAt,
        elapsedMs: collectionFinishedAt - session.startedAt
      }
    };
  }

  async function fetchJobActivityDetail(job = {}, deadlineAt = 0) {
    const securityId = String(job.securityId || '');
    const lid = String(job.lid || '');
    if (!securityId || !lid) return { ok: false, skipped: true, error: 'DETAIL_PARAMS_MISSING' };
    const remainingMs = deadlineAt ? Math.max(0, deadlineAt - Date.now()) : 1800;
    if (remainingMs < 250) return { ok: false, skipped: true, error: 'ACTIVITY_DEADLINE' };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min(1800, remainingMs));
    try {
      const url = new URL('/wapi/zpgeek/job/detail.json', location.origin);
      url.searchParams.set('securityId', securityId);
      url.searchParams.set('lid', lid);
      const response = await fetch(url.href, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) {
        return {
          ok: false,
          halt: response.status === 429 || response.status === 403,
          error: 'ACTIVITY_HTTP_' + response.status
        };
      }
      const payload = await response.json();
      const code = Number(payload?.code);
      if (code !== 0) {
        // 任意非零响应都立即熔断，不重试，不放大 BOSS 风控。
        return { ok: false, halt: true, code, error: 'ACTIVITY_API_' + code };
      }
      const zpData = payload?.zpData || {};
      const actualJobId = String(zpData?.jobInfo?.encryptId || '');
      const expectedJobId = String(job.jobId || '');
      if (actualJobId && expectedJobId && actualJobId !== expectedJobId) {
        return { ok: false, halt: true, error: 'ACTIVITY_JOB_MISMATCH' };
      }
      const bossInfo = zpData?.bossInfo || {};
      const bossOnline = bossInfo.bossOnline === true || bossInfo.bossOnline === 1;
      const activeText = bossOnline ? '在线' : String(bossInfo.activeTimeDesc || '').trim();
      const metadata = rememberJobNetworkMetadata({
        jobId: actualJobId || expectedJobId,
        securityId,
        lid,
        bossId: String(bossInfo.encryptBossId || job.bossId || ''),
        bossName: String(bossInfo.name || job.hrName || '').trim(),
        bossTitle: String(bossInfo.title || '').trim(),
        brandName: String(bossInfo.brandName || job.company || '').trim(),
        bossOnline,
        activeText,
        source: 'activity-prefetch'
      });
      return { ok: true, ...(metadata || {}), activeText, bossOnline };
    } catch (error) {
      return {
        ok: false,
        halt: error?.name !== 'AbortError',
        error: error?.name === 'AbortError' ? 'ACTIVITY_TIMEOUT' : 'ACTIVITY_FETCH_FAILED'
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function enrichJobActivities(payload = {}) {
    // 预览期核对 HR 活跃度：直连列表 detail API（BOSS 原生接口，带登录态），
    // 不点卡片、不导航、不离开列表页（与「左侧职位页保持原样」一致）。
    // 逐岗限时抓取；遇到 429/403 立即熔断，避免触发风控。
    const requested = Array.isArray(payload.jobs) ? payload.jobs : [];
    const deadlineAt = Number(payload.deadlineAt) || (Date.now() + 60000);
    const activities = [];
    let eligibleCount = 0;
    let checkedCount = 0;
    let halted = false;
    let haltError = "";
    for (const job of requested) {
      if (Date.now() >= deadlineAt) {
        halted = true;
        haltError = "ACTIVITY_DEADLINE";
        break;
      }
      eligibleCount += 1;
      const res = await fetchJobActivityDetail(job, deadlineAt);
      if (res?.halt) {
        halted = true;
        haltError = res.error || res.message || "";
        break;
      }
      if (res?.ok) {
        activities.push({
          jobId: String(job?.jobId || ""),
          activeText: String(res.activeText || "").trim(),
          bossOnline: res.bossOnline === true,
          goldHunter: res.goldHunter === true,
          hrTitle: String(res.bossTitle || "").trim(),
          bossName: String(res.bossName || "").trim(),
          bossId: String(res.bossId || job?.bossId || "").trim()
        });
        checkedCount += 1;
      }
    }
    return {
      ok: true,
      activities,
      requestedCount: requested.length,
      eligibleCount,
      checkedCount,
      halted,
      haltError,
      skipped: false,
      source: "list-api-detail"
    };
  }

  function pageInfo() {
    const cards = getJobCards();
    const hasChat = typeof hasUsableChatInput === "function" ? hasUsableChatInput() : Boolean(getChatInput());
    const savedListCtx = getSavedListCtx();
    const onList = isListLikePage();
    const savedHref = getSavedListHref();
    const savedExpect = String(savedListCtx?.expectLabel || "");
    const savedHints = Array.isArray(savedListCtx?.filterHints)
      ? savedListCtx.filterHints.slice(0, 12)
      : [];
    const liveExpect = onList ? String(detectSelectedJobExpect() || "") : "";
    const liveHints = onList ? detectActiveFilterHints() : [];
    // PING is also used while the source tab is on a detail/chat page. Expose
    // the last intact list context for delivery recovery and diagnostics.
    const listHref = onList ? location.href : savedHref;
    const listExpectLabel = onList ? (liveExpect || savedExpect) : savedExpect;
    const listFilterHints = onList
      ? (liveHints.length ? liveHints : savedHints)
      : savedHints;
    return {
      href: location.href,
      title: document.title,
      ready: document.readyState,
      cardCount: cards.length,
      isBoss: /zhipin\.com|bosszhipin\.com/i.test(location.hostname),
      hasDetail: Boolean(firstEl(SELECTORS.detailRoot)),
      hasChatBtn: Boolean(firstEl(SELECTORS.chatOnDetail)),
      hasChatInput: hasChat,
      isChatPage: /\/chat/i.test(location.pathname + location.hash),
      path: location.pathname,
      // Keep the last intact list target available when delivery temporarily
      // operates from a detail or chat page.
      savedListHref: savedHref,
      savedListExpectLabel: savedExpect,
      savedListFilterHints: savedHints,
      listHref,
      listExpectLabel,
      listFilterHints
    };
  }

  function diagnose() {
    const report = {
      url: location.href,
      counts: {},
      samples: [],
      ok: false
    };
    const map = {
      card: SELECTORS.card[0],
      title: SELECTORS.title[0],
      company: SELECTORS.company[0],
      location: SELECTORS.location[0],
      salary: SELECTORS.salary[0],
      chat: SELECTORS.chatOnDetail[0],
      detail: SELECTORS.detailRoot[0]
    };
    for (const [k, sel] of Object.entries(map)) {
      report.counts[k] = document.querySelectorAll(sel).length;
    }
    report.counts.cardsTotal = getJobCards().length;
    report.samples = getJobCards()
      .slice(0, 3)
      .map((c, i) => parseJobCard(c, i));
    report.ok = report.counts.cardsTotal > 0;
    return report;
  }

  async function scanJobs(payload = {}) {
    try { rememberListHref(); } catch (_) {}
    const sessionId = String(payload.scanSessionId || 'default');
    const continuingSession =
      payload.resetSession === false &&
      window.__BHT_SCAN_SESSION__?.id === sessionId &&
      isListLikePage();
    const ensured = continuingSession
      ? { ok: true, via: 'scan-session' }
      : await ensureJobList({
        maxWaitMs: payload.maxWaitMs || 12000,
        scroll: false
      });
    if (!ensured.ok) {
      debugTrace("scan_jobs_no_list", { href: location.href, error: ensured.error, message: ensured.message }, "warn");
      return {
        ok: false,
        error: ensured.error || "LIST_NOT_FOUND",
        message: ensured.message || "未找到职位列表页，请先打开 BOSS 职位列表页再扫描预览",
        count: 0,
        jobs: [],
        shouldNavigate: ensured.shouldNavigate === true,
        targetHref: ensured.targetHref || "",
        via: ensured.via || "",
        page: pageInfo()
      };
    }
    // Legacy callers may still provide an expectation. Apply it only before
    // the first batch; continuation batches must not change the active list.
    if (payload.resetSession !== false && payload.listExpectLabel && isListLikePage()) {
      try { await restoreJobExpectIfNeeded(payload.listExpectLabel); } catch (_) {}
    }
    const adaptive = await scanAdaptiveJobBatch(payload);
    const cards = getJobCards();
    const jobs = adaptive.jobs;
    debugTrace("scan_jobs_snapshot", {
      cardCount: cards.length,
      parsedCount: adaptive.count,
      returnedCount: jobs.length,
      missingCompanyCount: jobs.filter((job) => !job.company).length,
      page: pageInfo(),
      jobs: jobs.slice(0, 5).map((job) => ({
        index: job.index,
        jobId: job.jobId,
        title: job.title,
        company: job.company,
        hrName: job.hrName,
        location: job.location,
        href: job.href
      }))
    }, jobs.some((job) => !job.company) ? "warn" : "debug");
    try{rememberListHref();}catch(_){} return { ok: true, listHref: (typeof getSavedListHref==="function"?getSavedListHref():"")||location.href, listExpectLabel: (typeof detectSelectedJobExpect==="function"?detectSelectedJobExpect():"")||"", listFilterHints: (typeof detectActiveFilterHints==="function"?detectActiveFilterHints():[]), page: pageInfo(),
      jobs,
      count: adaptive.count,
      scanMeta: adaptive.scanMeta,
      diagnose: {
        cardCount: cards.length,
        companySelectorHits: document.querySelectorAll(SELECTORS.company[0]).length,
        titleSelectorHits: document.querySelectorAll(SELECTORS.title[0]).length
      }
    };
  }

  function findCardByJob(job) {
    const cards = getJobCards();
    if (!cards.length || !job) return null;
    const wantTitle = normalizeText(job.title || "");
    const wantCompany = normalizeText(job.company || "");
    const wantId = job.jobId || "";
    const wantHref = job.href || "";

    if (wantId) {
      const byId = cards.find((el, i) => parseJobCard(el, i).jobId === wantId);
      if (byId) return byId;
    }
    if (wantHref) {
      const idFromHref = extractJobIdFromHref(wantHref);
      if (idFromHref) {
        const byHref = cards.find((el, i) => {
          const p = parseJobCard(el, i);
          return p.jobId === idFromHref || (p.href && p.href.includes(idFromHref));
        });
        if (byHref) return byHref;
      }
    }
    if (wantTitle) {
      const exact = cards.find((el, i) => {
        const p = parseJobCard(el, i);
        const t = normalizeText(p.title || "");
        const co = normalizeText(p.company || "");
        if (t !== wantTitle) return false;
        if (wantCompany && co && co !== wantCompany) return false;
        return true;
      });
      if (exact) return exact;
      const fuzzy = cards.find((el, i) => {
        const p = parseJobCard(el, i);
        const t = normalizeText(p.title || "");
        return t && (t.includes(wantTitle) || wantTitle.includes(t));
      });
      if (fuzzy) return fuzzy;
    }
    if (job.index != null && cards[job.index]) {
      const p = parseJobCard(cards[job.index], job.index);
      if (!wantTitle || normalizeText(p.title).includes(wantTitle) || wantTitle.includes(normalizeText(p.title))) {
        return cards[job.index];
      }
    }
    return null;
  }

  function getChatRoot() {
    const input = (() => {
      try { return document.querySelector("#bht-mock-chat #chat-input, #chat-input, .chat-input [contenteditable='true']"); } catch (_) { return null; }
    })();
    if (input) {
      const near = input.closest?.(".chat-conversation, .chat-box, .conversation-box, .chat-container, .dialog-chat, #bht-mock-chat, .message-input, .chat-input");
      if (near) return near;
    }
    for (const sel of SELECTORS.chatRoot) {
      try {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          try {
            const st = getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.width > 40 && r.height > 40) return el;
          } catch (_) {}
        }
      } catch (_) {}
    }
    return firstEl(SELECTORS.chatRoot);
  }

  function getChatInput() {
    // 优先可见且像聊天输入的节点
    for (const sel of SELECTORS.chatInput) {
      try {
        const list = Array.from(document.querySelectorAll(sel));
        for (const el of list) {
          try {
            const st = getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.height < 10) continue;
            const ph = el.getAttribute("data-placeholder") || el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
            const nearChat = el.closest?.(".chat-conversation, .chat-box, .conversation-box, .chat-container, .dialog-chat, .chat-input, .message-input, #bht-mock-chat");
            if (nearChat || /发送|Enter|消息|沟通|聊/.test(ph) || /chat-input|#chat-input/.test(sel)) return el;
          } catch (_) {}
        }
      } catch (_) {}
    }
    return firstEl(SELECTORS.chatInput);
  }

  

  function findConversationActionButton(scope = document) {
    const roots = [scope, document].filter(Boolean);
    const selector = [
      "a.op-btn-chat",
      "button.op-btn-chat",
      ".job-detail-op a",
      ".job-detail-op button",
      ".job-detail-box a",
      ".job-detail-box button",
      "a.btn-startchat",
      "button.btn-startchat",
      "[class*='startchat']",
      "[data-ka*='chat']",
      "[ka*='chat']",
      ".btn-container a",
      ".btn-container button",
      "a",
      "button",
      "[role='button']"
    ].join(",");
    const candidates = [];
    const seen = new Set();
    for (const root of roots) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch (_) {}
      for (const node of nodes) {
        const interactive = node.matches?.("a,button,[role='button']")
          ? node
          : node.closest?.("a,button,[role='button']") || node;
        if (!interactive || seen.has(interactive)) continue;
        seen.add(interactive);
        const label = textOf(interactive).replace(/\s+/g, " ").trim();
        if (!/^(立即沟通|继续沟通|打招呼)$/.test(label)) continue;
        const className = String(interactive.className || "");
        const tag = String(interactive.tagName || "").toUpperCase();
        const explicitlyInteractive = /^(A|BUTTON)$/.test(tag) || interactive.getAttribute?.("role") === "button";
        const explicitChatClass = /op-btn-chat|btn-startchat|start-chat|chat-btn/i.test(className);
        if (!explicitlyInteractive && !explicitChatClass) continue;
        if (!explicitlyInteractive && /wrap|container/i.test(className)) continue;
        let area = Number.MAX_SAFE_INTEGER;
        try {
          const style = getComputedStyle(interactive);
          const rect = interactive.getBoundingClientRect();
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) continue;
          if (rect.width < 18 || rect.height < 10) continue;
          area = rect.width * rect.height;
        } catch (_) {}
        if (interactive.disabled || interactive.getAttribute?.("aria-disabled") === "true") continue;
        candidates.push({
          element: interactive,
          score: (/^(A|BUTTON)$/.test(tag) ? 100 : 60) + (explicitChatClass ? 20 : 0),
          area
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.area - b.area);
    return candidates[0]?.element || null;
  }

  async function clickChatButton() {
    const btn = findConversationActionButton(document);

    if (!btn) return { ok: false, error: "CHAT_BUTTON_NOT_FOUND", buttonText: "" };
    const buttonText = textOf(btn);
    // 已是继续沟通：也点开会话，便于发补充消息
    clickLikeHuman(btn);
    return { ok: true, buttonText, already: /继续沟通/.test(buttonText) };
  }

  
  function detectLoginModal() {
    // 避免频繁读 body.innerText（BOSS 大页极慢，会导致发消息循环卡死）
    const modalRoots = Array.from(
      document.querySelectorAll(
        ".dialog-wrap, .dialog-container, .boss-dialog, .login-dialog, .login-container, .geetest_panel, [class*='login'], [class*='dialog'], [class*='modal'], [role='dialog']"
      )
    ).filter((el) => {
      try {
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 80 && r.height > 80;
      } catch (_) {
        return false;
      }
    }).slice(0, 8);

    const chunks = modalRoots.map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").slice(0, 500));
    // 轻量补充：标题/固定登录入口，不做全 body 扫描
    try {
      const loginEntry = document.querySelector(".nav-login, .btn-login, a[href*='login'], .header-login");
      if (loginEntry) chunks.push(textOf(loginEntry));
    } catch (_) {}
    const text = chunks.join(" | ");
    const markers = [
      "登录立即与BOSS沟通",
      "APP扫码登录",
      "登录/注册",
      "短信验证码",
      "登录立即沟通",
      "扫码登录",
      "安全验证"
    ];
    const hit = markers.find((m) => text.includes(m));
    if (hit) {
      return { ok: true, message: "检测到登录/验证弹窗，请先登录 BOSS 直聘后再使用海投功能", marker: hit };
    }
    // 路径级未登录
    if (/\/web\/user\/?$|passport|\/login/i.test(location.pathname + location.href)) {
      return { ok: true, message: "当前未登录或处于登录页，请先登录 BOSS 直聘后再使用海投功能", marker: "path" };
    }
    return { ok: false };
  }

function dismissCommonDialogs() {
    const labels = /确定|继续|我知道了|开启|同意|稍后|允许|关闭|取消/;
    // 优先点确认类，避免误点取消
    const preferred = Array.from(document.querySelectorAll("button,a,.btn")).filter((el) =>
      /确定|继续|我知道了|开启|同意|允许/.test(textOf(el))
    );
    if (preferred[0]) {
      clickLikeHuman(preferred[0]);
      return true;
    }
    const any = Array.from(document.querySelectorAll("button,a,.btn")).find((el) => labels.test(textOf(el)));
    if (any && /确定|继续|我知道了/.test(textOf(any))) {
      clickLikeHuman(any);
      return true;
    }
    return false;
  }

  function isChatPage() {
    return /\/chat|geek\/chat|conversation/i.test(location.pathname + location.hash);
  }

  function hasUsableChatInput() {
    const input = getChatInput();
    if (!input) return false;
    // 排除隐藏节点
    const style = window.getComputedStyle(input);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) return false;
    const rect = input.getBoundingClientRect();
    if (!(rect.width > 20 && rect.height > 10)) return false;
    // 防止职位列表页误命中其它 contenteditable
    const ph = (
      input.getAttribute("data-placeholder") ||
      input.getAttribute("placeholder") ||
      input.getAttribute("aria-label") ||
      ""
    );
    const looksChat =
      Boolean(getChatRoot()) ||
      /\/chat/i.test(location.pathname + location.hash) ||
      /发送|Enter|消息|沟通|聊/.test(ph) ||
      Boolean(input.closest?.(".chat-conversation, .chat-box, .conversation-box, .chat-container, .dialog-chat, .chat-input, .message-input, #chat-input"));
    return looksChat;
  }

  async function waitForChat(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      dismissCommonDialogs();
      if (hasUsableChatInput()) return true;
      // 有聊天容器也继续等输入框
      if (getChatRoot() && Date.now() - start > 1500) {
        // 尝试聚焦容器
        getChatRoot()?.click?.();
      }
      await sleep(280);
    }
    return hasUsableChatInput();
  }

  async function ensureJobList({ maxWaitMs = 12000, scroll = true, noHomeNav = false } = {}) {
    const readyCount = () => getJobCards().length;
    const startedHref = location.href;
    if (readyCount() > 0) {
      return { ok: true, count: readyCount(), restored: false, href: location.href, via: "already-list" };
    }

    // 聊天页先返回（软返回，不硬刷新）
    if (isChatPage()) {
      try { history.back(); } catch (_) {}
      await sleep(900);
    }
    await closeChatPanel();
    await sleep(300);

    const savedTarget = getSavedJobListNavigationTarget();
    if (!noHomeNav && !isListLikePage() && savedTarget && !sameListUrl(location.href, savedTarget)) {
      return {
        ok: false,
        count: 0,
        restored: false,
        href: location.href,
        error: "LIST_NAV_REQUIRED",
        message: "当前不在 BOSS 职位列表页，正在恢复上次职位列表…",
        shouldNavigate: true,
        targetHref: savedTarget,
        via: "saved-list-navigation-required"
      };
    }

    if (scroll && isListLikePage()) {
      try { await autoScrollList(6); } catch (_) {}
    }

    const start = Date.now();
    let navTried = false;
    let navAttemptedAt = 0;
    while (Date.now() - start < maxWaitMs) {
      if (readyCount() > 0) {
        return {
          ok: true,
          count: readyCount(),
          restored: location.href !== startedHref,
          href: location.href,
          via: navTried ? "job-nav" : "soft-wait"
        };
      }

      // 仅当当前明显不是职位列表页时，才尝试点顶部「职位」入口。
      // 禁止点「推荐/首页」：会把用户选好的求职期望与网页筛选冲掉。
      if (!noHomeNav && !isListLikePage() && !navTried) {
        const jobNav = Array.from(document.querySelectorAll("a,button,[role='link']"))
          .filter((el) => {
            try {
              const rect = el.getBoundingClientRect();
              return rect.width > 8 && rect.height > 8;
            } catch (_) {
              return false;
            }
          })
          .find((el) => {
            const t = textOf(el).replace(/\s+/g, "").trim();
            const href = el.getAttribute?.("href") || "";
            return t === "职位" || t === "职位列表" || t === "找工作" || isListLikePage(href);
          });
        navTried = true;
        navAttemptedAt = Date.now();
        if (jobNav) {
          clickLikeHuman(jobNav);
          await sleep(800);
        }
      }

      if (!isListLikePage() && (navTried || noHomeNav)) {
        if (!navAttemptedAt) navAttemptedAt = Date.now();
        if (Date.now() - navAttemptedAt >= 1600) {
          return {
            ok: false,
            count: 0,
            restored: false,
            href: location.href,
            error: "LIST_NAV_REQUIRED",
            message: "当前不在 BOSS 职位列表页，正在自动跳转到职位列表…",
            shouldNavigate: !noHomeNav,
            targetHref: getJobListNavigationTarget(),
            via: "background-navigation-required"
          };
        }
      }
      if (scroll && (Date.now() - start) > 2500) {
        try { window.scrollBy(0, 600); } catch (_) {}
      }
      await sleep(400);
    }

    const count = readyCount();
    return {
      ok: count > 0,
      count,
      restored: true,
      href: location.href,
      error: count > 0 ? "" : "LIST_NOT_FOUND",
      message: count > 0 ? "" : "已在 BOSS 职位列表页，但未找到岗位卡片。请确认已登录、当前筛选下有岗位，或刷新页面后重试",
      shouldNavigate: false,
      targetHref: "",
      via: "list-cards-not-found"
    };
  }

  async function closeChatPanel() {
    // 只关聊天浮层，避免 document ESC 把列表页状态打乱
    const selectors = [
      ".chat-conversation .icon-close",
      ".chat-box .icon-close",
      ".dialog-chat .icon-close",
      ".chat-container [class*='close']",
      "div.chat-conversation button[aria-label*='关闭']",
      ".boss-dialog .icon-close",
      ".dialog-wrap .icon-close"
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          clickLikeHuman(el);
          await sleep(250);
          break;
        }
      } catch (_) {}
    }
    const closeCandidates = Array.from(
      document.querySelectorAll(
        ".chat-conversation button, .chat-box button, .dialog-chat button, .chat-container button, [class*='chat'] [class*='close']"
      )
    ).filter((el) => {
      const t = textOf(el);
      const aria = el.getAttribute?.("aria-label") || "";
      const cls = String(el.className || "");
      return t === "关闭" || t === "×" || /关闭/.test(aria) || /close|icon-close|chat-close/i.test(cls);
    });
    if (closeCandidates[0]) {
      clickLikeHuman(closeCandidates[0]);
      await sleep(250);
    }
    return { ok: true, contentVersion: BHT_CONTENT_VERSION };
  }

  async function returnToJobList(payload = {}) {
    const target = (payload && payload.listHref) || getSavedListHref();
    const expectLabel = String(
      (payload && (payload.expectLabel || payload.listExpectLabel)) ||
      getSavedListCtx()?.expectLabel ||
      ""
    ).trim();
    try { await closeChatPanel(); } catch (_) {}
    await sleep(250);

    // 1) 已在列表且有卡片：绝不硬刷新，最多软恢复求职期望
    if (getJobCards().length >= 3 && isListLikePage()) {
      try { rememberListHref(); } catch (_) {}
      const restored = await restoreJobExpectIfNeeded(expectLabel);
      return {
        ok: true,
        count: getJobCards().length,
        href: location.href,
        via: "still-on-list",
        expectRestored: restored,
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    // 2) 已在列表路径但卡片暂时为 0：软等待，不 assign
    if (isListLikePage()) {
      let ensured = await ensureJobList({ maxWaitMs: 8000, scroll: true, noHomeNav: true });
      if (ensured?.ok && (ensured.count || 0) > 0) {
        const restored = await restoreJobExpectIfNeeded(expectLabel);
        return {
          ...ensured,
          via: "soft-wait-list",
          expectRestored: restored,
          contentVersion: BHT_CONTENT_VERSION
        };
      }
    }

    // 3) 聊天页/会话页：history.back 软返回
    if (isChatPage() || (hasUsableChatInput() && getJobCards().length === 0)) {
      try { history.back(); } catch (_) {}
      await sleep(1100);
      try { await closeChatPanel(); } catch (_) {}
      if (getJobCards().length >= 1 || isListLikePage()) {
        await ensureJobList({ maxWaitMs: 5000, scroll: true, noHomeNav: true });
        const restored = await restoreJobExpectIfNeeded(expectLabel);
        return {
          ok: getJobCards().length > 0,
          count: getJobCards().length,
          href: location.href,
          via: "history-back",
          expectRestored: restored,
          contentVersion: BHT_CONTENT_VERSION
        };
      }
    }

    // 4) 再软 ensure 一次（不点推荐、不硬跳裸 jobs）
    let ensured = await ensureJobList({ maxWaitMs: 8000, scroll: true, noHomeNav: true });
    if (ensured?.ok && (ensured.count || 0) > 0) {
      const restored = await restoreJobExpectIfNeeded(expectLabel);
      return {
        ...ensured,
        via: "ensure-soft",
        expectRestored: restored,
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    // 5) 最后手段：仅当有完整 listHref 且当前不在同一 URL 时才硬导航。
    //    硬导航会丢掉 SPA 状态；因此写入 restore 标记，加载后尽量点回求职期望。
    if (target && !sameListUrl(location.href, target)) {
      try {
        sessionStorage.setItem("bht_list_href", target);
        if (expectLabel) sessionStorage.setItem("bht_restore_expect", expectLabel);
        const ctx = { ...(getSavedListCtx() || {}), href: target, expectLabel, at: Date.now() };
        sessionStorage.setItem("bht_list_ctx", JSON.stringify(ctx));
        window.__BHT_LIST_HREF__ = target;
        window.__BHT_LIST_CTX__ = ctx;
      } catch (_) {}
      setTimeout(() => {
        try { location.assign(target); } catch (_) {
          try { location.href = target; } catch (__) {}
        }
      }, 120);
      return {
        ok: true,
        navigating: true,
        href: target,
        via: "hard-assign-last-resort",
        expectLabel,
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    return {
      ok: false,
      count: getJobCards().length,
      href: location.href,
      error: "LIST_NOT_FOUND",
      message: "无法恢复职位列表（已避免硬刷新清空筛选）。请回到原来的求职期望/筛选列表后重新扫描预览",
      contentVersion: BHT_CONTENT_VERSION
    };
  }

  async function findCardByScrolling(job, maxRounds = 40) {
    const want = normalizeText(job?.title || "");
    const tryFind = () => {
      let card = findCardByJob(job);
      if (card) return card;
      if (!want) return null;
      const nameEls = Array.from(
        document.querySelectorAll(
          "ul.rec-job-list a.job-name, .job-list-container a.job-name, a.job-name, .job-name"
        )
      );
      const hit = nameEls.find((el) => {
        if (el.closest?.(".job-detail-box, .job-detail-container")) return false;
        const t = normalizeText(textOf(el));
        return t && (t === want || t.includes(want) || want.includes(t));
      });
      if (!hit) return null;
      return (
        hit.closest("li.job-card-box") ||
        hit.closest(".job-card-box") ||
        hit.closest(".job-card-wrap") ||
        hit.closest("li") ||
        hit
      );
    };

    let card = tryFind();
    if (card) return card;
    try { window.scrollTo(0, 0); } catch (_) {}
    await sleep(350);
    card = tryFind();
    if (card) return card;

    for (let i = 0; i < maxRounds; i++) {
      try { window.scrollBy(0, 320); } catch (_) {}
      await sleep(200);
      card = tryFind();
      if (card) return card;
    }
    return null;
  }

﻿  async function openJobByHrefFallback(href, title) {
    const wantHref = String(href || "");
    const wantId = extractJobIdFromHref(wantHref);
    if (!wantHref && !wantId) return { ok: false };

    // 1) 全页再找一遍（含非主列表）
    const anchors = Array.from(document.querySelectorAll("a[href*='job_detail'], a.job-name[href], a[href*='jobId=']"));
    let hit = null;
    for (const a of anchors) {
      const h = a.href || a.getAttribute("href") || "";
      const id = extractJobIdFromHref(h);
      if ((wantId && (id === wantId || h.includes(wantId))) || (wantHref && (h === wantHref || h.includes(wantId || "___")))) {
        hit = a;
        break;
      }
    }
    if (hit) {
      const card = hit.closest("li.job-card-box, .job-card-box, .job-card-wrap, li") || hit;
      try { card.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
      preventLinkNavigation(card, 1800);
      clickLikeHuman(hit);
      await sleep(600);
      return { ok: true, via: "href-global", card, titleEl: hit };
    }

    // 2) 合成锚点点击（让 BOSS SPA 自己路由到岗位详情，再找沟通按钮）
    try {
      const a = document.createElement("a");
      a.href = wantHref || (wantId ? location.origin + "/job_detail/" + wantId + ".html" : "#");
      a.className = "job-name bht-synthetic-job";
      a.textContent = title || "job";
      a.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:auto;";
      const stopNav = (e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} };
      a.addEventListener("click", stopNav, true);
      document.body.appendChild(a);
      // 触发站点自己的委托点击逻辑，同时阻止整页跳转
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      await sleep(900);
      a.remove();
      if (firstEl(SELECTORS.detailRoot) || firstEl(SELECTORS.chatOnDetail) || hasUsableChatInput()) {
        return { ok: true, via: "href-synthetic" };
      }
    } catch (_) {}

    return { ok: false };
  }

    
async function startChatOnCurrentDetail(job = {}) {
    if (typeof detectLoginModal === "function") {
      const loginHit = detectLoginModal();
      if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
    }
    // 已在聊天页/会话已打开：直接成功，避免二次点「立即沟通」失败
    if (hasUsableChatInput()) {
      return {
        ok: true,
        already: true,
        job: job || {},
        contentVersion: BHT_CONTENT_VERSION,
        matchedVia: "already-in-chat"
      };
    }
    let clicked = { ok: false };
    for (let i = 0; i < 12; i++) {
      clicked = await clickChatButton();
      if (clicked.ok) break;
      await sleep(300);
    }
    if (!clicked.ok) {
      if (typeof detectLoginModal === "function") {
        const loginHit = detectLoginModal();
        if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
      }
      return { ok: false, error: "CHAT_BUTTON_NOT_FOUND", message: "当前页未找到立即沟通按钮", contentVersion: BHT_CONTENT_VERSION };
    }
    await sleep(400);
    dismissCommonDialogs();
    const chatReady = await waitForChat(16000);
    if (!chatReady) {
      if (typeof detectLoginModal === "function") {
        const loginHit = detectLoginModal();
        if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
      }
      return { ok: false, error: "CHAT_TIMEOUT", message: "聊天输入框未出现", contentVersion: BHT_CONTENT_VERSION };
    }
    return {
      ok: true,
      already: Boolean(clicked.already),
      job: job || {},
      contentVersion: BHT_CONTENT_VERSION,
      matchedVia: "current-detail"
    };
  }

async function startChat(job, opts = {}) {
    try { rememberListHref(); } catch (_) {}
    const inputJob0 = (opts && opts.job) || job || {};
    const preferDirect = Boolean(
      opts?.preferDirect ||
      opts?.direct ||
      opts?.skipListMatch ||
      opts?.skipScroll
    );
    const onJobLikePage =
      Boolean(firstEl(SELECTORS.detailRoot)) ||
      Boolean(firstEl(SELECTORS.chatOnDetail)) ||
      /\/chat/i.test(location.pathname) ||
      /job_detail|encryptJobId|\/geek\/job/i.test(location.href);

    // 聊天输入已可用：立刻成功
    if (hasUsableChatInput()) {
      return {
        ok: true,
        already: true,
        job: inputJob0,
        contentVersion: BHT_CONTENT_VERSION,
        matchedVia: "already-in-chat"
      };
    }

    // 双页架构：工作页已导航到目标岗详情时，禁止再回列表匹配/滚动
    if (preferDirect || onJobLikePage) {
      log("startChat preferDirect/onJobLike", { preferDirect, href: location.href.slice(0, 160), cards: getJobCards().length });
      return await startChatOnCurrentDetail(inputJob0);
    }
    const inputJob = (opts && opts.job) || job || {};
    const wantTitle = normalizeText(inputJob.title || "");
    const wantCompany = normalizeText(inputJob.company || "");
    const wantId = String(inputJob.jobId || "");
    const wantHref = String(inputJob.href || "");
    const wantHrefId =
      extractJobIdFromHref(wantHref) ||
      (wantId && !wantId.startsWith("name_") && !wantId.startsWith("dom_") ? wantId : "");

    const releaseNavGuard = installJobNavGuard(25000);
    try {
    try { await closeChatPanel(); } catch (_) {}
    await sleep(180);

    const getListScroller = () => {
      const bySel = firstEl(SELECTORS.listScroller);
      if (bySel) return bySel;
      const list =
        document.querySelector("ul.rec-job-list") ||
        document.querySelector(".job-list-container") ||
        document.querySelector(".job-recommend-result") ||
        document.querySelector(".search-job-result");
      if (list) {
        let p = list;
        for (let i = 0; i < 6 && p; i++) {
          try {
            const st = getComputedStyle(p);
            const oy = st.overflowY || st.overflow;
            if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 40) return p;
          } catch (_) {}
          p = p.parentElement;
        }
      }
      return document.scrollingElement || document.documentElement;
    };

    const mainListRoot = () =>
      document.querySelector("ul.rec-job-list") ||
      document.querySelector(".job-list-container") ||
      document.querySelector(".job-recommend-result") ||
      document.querySelector(".search-job-result") ||
      document.querySelector(".recommend-result-job") ||
      document.querySelector(".job-list-box") ||
      null;

    const isInMainList = (el, strict = true) => {
      if (!el) return false;
      if (el.closest(".job-detail-box, .job-detail-container, .chat-container, .chat-box, .dialog-chat, #chat-box")) {
        return false;
      }
      const root = mainListRoot();
      if (root) return root.contains(el);
      return !strict;
    };

    const visibleTitleSamples = () => {
      const root = mainListRoot() || document;
      return Array.from(root.querySelectorAll("a.job-name, .job-name"))
        .filter((el) => isInMainList(el, false))
        .map((el) => textOf(el))
        .filter(Boolean)
        .slice(0, 8);
    };

    const scoreMatch = (p) => {
      if (!p) return -1;
      let score = 0;
      const t = normalizeText(p.title || "");
      const tc = coreTitle(p.title || "");
      const wantCore = coreTitle(inputJob.title || "");
      const co = normalizeText(p.company || "");
      if (wantId && p.jobId && p.jobId === wantId) score += 100;
      if (wantHrefId && (p.jobId === wantHrefId || (p.href && p.href.includes(wantHrefId)))) score += 100;
      if (wantHref && p.href && (p.href === wantHref || (wantHrefId && p.href.includes(wantHrefId)))) score += 90;
      if (wantTitle && t) {
        if (t === wantTitle || (wantCore && tc === wantCore)) score += 50;
        else if (
          t.includes(wantTitle) ||
          wantTitle.includes(t) ||
          (wantCore && tc && (tc.includes(wantCore) || wantCore.includes(tc)))
        ) {
          score += 35;
        } else if (!(wantId || wantHrefId)) {
          if (!(wantCompany && co && (co === wantCompany || co.includes(wantCompany) || wantCompany.includes(co)))) {
            return -1;
          }
        }
      } else if (!wantId && !wantHrefId) {
        return -1;
      }
      if (wantCompany && co) {
        if (co === wantCompany) score += 12;
        else if (co.includes(wantCompany) || wantCompany.includes(co)) score += 6;
      }
      return score;
    };

    const cardFromNameEl = (el) =>
      el.closest("li.job-card-box") ||
      el.closest(".job-card-box") ||
      el.closest(".job-card-wrap") ||
      el.closest("li") ||
      el;

    const findByHref = (strict = true) => {
      if (!wantHrefId && !wantHref) return null;
      const anchors = Array.from(
        document.querySelectorAll("a.job-name[href], a[href*='job_detail'], a[href*='jobId=']")
      );
      for (const el of anchors) {
        if (!isInMainList(el, strict)) continue;
        const href = el.href || el.getAttribute("href") || "";
        const id = extractJobIdFromHref(href);
        if (wantHrefId && (id === wantHrefId || href.includes(wantHrefId))) {
          const card = cardFromNameEl(el);
          const live = parseJobCard(card, 0);
          return {
            card,
            live: { ...live, title: live.title || textOf(el), href: live.href || href },
            score: 100,
            via: "href"
          };
        }
        if (wantHref && (href === wantHref || href.endsWith(wantHref) || wantHref.endsWith(href))) {
          const card = cardFromNameEl(el);
          const live = parseJobCard(card, 0);
          return {
            card,
            live: { ...live, title: live.title || textOf(el), href: live.href || href },
            score: 95,
            via: "href-exact"
          };
        }
      }
      return null;
    };

    const tryPickVisible = (strict = true) => {
      const byHref = findByHref(strict);
      if (byHref) return byHref;

      let best = null;
      let bestScore = 0;
      const cards = getJobCards().filter((card) => isInMainList(card, strict));
      for (let i = 0; i < cards.length; i++) {
        const p = parseJobCard(cards[i], i);
        const sc = scoreMatch(p);
        if (sc > bestScore) {
          bestScore = sc;
          best = { card: cards[i], live: p, score: sc, via: "card" };
        }
      }
      const root = mainListRoot() || document;
      const names = Array.from(root.querySelectorAll("a.job-name, .job-name")).filter((el) =>
        isInMainList(el, strict)
      );
      for (const el of names) {
        const card = cardFromNameEl(el);
        const live = parseJobCard(card, 0);
        const mergedLive = { ...live, title: live.title || textOf(el), href: live.href || el.href || "" };
        const sc = scoreMatch(mergedLive);
        if (sc > bestScore) {
          bestScore = sc;
          best = { card, live: mergedLive, score: sc, via: "name" };
        }
      }
      const minScore = wantHrefId || (wantId && !String(wantId).startsWith("name_")) ? 25 : 35;
      return bestScore >= minScore ? best : null;
    };

    if (getJobCards().length === 0) {
      try { await ensureJobList({ maxWaitMs: 7000, scroll: true }); } catch (_) {}
    }

    // HREF_FIRST_OPEN: 有 jobId/href 时优先直达，避免长滚动把列表刷成别的 Feed
    let picked = null;
    if (wantHrefId || wantHref) {
      const byHrefNow = typeof findByHref === 'function' ? (findByHref(true) || findByHref(false)) : null;
      if (byHrefNow) picked = byHrefNow;
    }
    if (!picked) picked = tryPickVisible(true) || tryPickVisible(false);

    if (!picked && (wantHrefId || wantHref)) {
      const fbEarly = await openJobByHrefFallback(wantHref || inputJob.href, inputJob.title || "");
      if (fbEarly.ok) {
        log("startChat early href fallback via", fbEarly.via, inputJob.title);
        if (fbEarly.card) {
          picked = { card: fbEarly.card, live: parseJobCard(fbEarly.card, 0), score: 90, via: fbEarly.via };
        } else {
          // 已尝试打开详情：直接走沟通按钮
          if (typeof detectLoginModal === "function") {
            const loginHit = detectLoginModal();
            if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
          }
          let clicked = { ok: false };
          for (let i = 0; i < 16; i++) {
            clicked = await clickChatButton();
            if (clicked.ok) break;
            await sleep(300);
          }
          if (clicked.ok) {
            await sleep(400);
            dismissCommonDialogs();
            if (typeof detectLoginModal === "function") {
              const loginHit = detectLoginModal();
              if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
            }
            const chatReady = await waitForChat(16000);
            if (chatReady) {
              return {
                ok: true,
                already: Boolean(clicked.already),
                job: inputJob,
                securityId: inputJob.securityId || "",
                contentVersion: BHT_CONTENT_VERSION,
                matchedVia: fbEarly.via,
                matchScore: 90
              };
            }
          }
        }
      }
    }

    if (!picked) {
      try { window.scrollTo(0, 0); } catch (_) {}
      try {
        const sc = getListScroller();
        if (sc) sc.scrollTop = 0;
      } catch (_) {}
      await sleep(280);
      picked = tryPickVisible(true) || tryPickVisible(false);
    }

    if (!picked) {
      for (let round = 0; round < 90 && !picked; round++) {
        try {
          const sc = getListScroller();
          if (sc && sc !== document.scrollingElement && sc !== document.documentElement) {
            sc.scrollTop = (sc.scrollTop || 0) + 420;
          } else {
            window.scrollBy(0, 420);
          }
        } catch (_) {
          try { window.scrollBy(0, 420); } catch (__) {}
        }
        await sleep(140);
        picked = tryPickVisible(true) || tryPickVisible(false);
        if (!picked && round > 0 && round % 15 === 0) {
          try {
            const jobNav = Array.from(document.querySelectorAll("a,button,span")).find((el) => {
              const t = textOf(el);
              return t === "职位" || t === "推荐";
            });
            if (jobNav) clickLikeHuman(jobNav);
          } catch (_) {}
        }
      }
    }

    if (!picked) {
      try {
        await returnToJobList();
      } catch (_) {
        try { await ensureJobList({ maxWaitMs: 5000, scroll: true }); } catch (__) {}
      }
      await sleep(300);
      picked = tryPickVisible(true) || tryPickVisible(false);
    }

    if (!picked) {
      // 列表虚拟化/Feed 变化时：按扫描时保存的 href 兜底打开
      const fb = await openJobByHrefFallback(wantHref || inputJob.href, inputJob.title || "");
      if (fb.ok) {
        log("startChat href fallback via", fb.via, inputJob.title);
        if (fb.card) {
          picked = {
            card: fb.card,
            live: parseJobCard(fb.card, 0),
            score: 80,
            via: fb.via
          };
        } else {
          // 无卡片：直接走详情/沟通按钮
          if (typeof detectLoginModal === "function") {
            const loginHit = detectLoginModal();
            if (loginHit.ok) {
              return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
            }
          }
          let clicked = { ok: false };
          for (let i = 0; i < 16; i++) {
            clicked = await clickChatButton();
            if (clicked.ok) break;
            await sleep(320);
          }
          if (!clicked.ok) {
            return {
              ok: false,
              error: "CHAT_BUTTON_NOT_FOUND",
              message: "已尝试按链接打开岗位，但未找到「立即沟通」按钮。请确认已登录且仍在职位列表页",
              contentVersion: BHT_CONTENT_VERSION
            };
          }
          await sleep(450);
          dismissCommonDialogs();
          const chatReady = await waitForChat(16000);
          if (!chatReady) {
            return {
              ok: false,
              error: "CHAT_TIMEOUT",
              message: "聊天输入框未出现。请确认已登录；如有弹窗请先处理",
              contentVersion: BHT_CONTENT_VERSION
            };
          }
          return {
            ok: true,
            already: Boolean(clicked.already),
            job: inputJob,
            securityId: inputJob.securityId || "",
            contentVersion: BHT_CONTENT_VERSION,
            matchedVia: fb.via,
            matchScore: 80
          };
        }
      }
    }

    if (!picked) {
      const titles = visibleTitleSamples();
      return {
        ok: false,
        error: "JOB_CARD_NOT_FOUND",
        message:
          "列表中找不到该岗位「" +
          (inputJob.title || "") +
          "」。当前列表可能已刷新，请重新扫描预览后再投" +
          (titles.length ? "\n当前可见示例：" + titles.join(" / ") : "") +
          "\n页面：" +
          (location.pathname || ""),
        listCount: getJobCards().length,
        href: location.href,
        wantHrefId,
        contentVersion: BHT_CONTENT_VERSION,
        samples: titles
      };
    }

    const { card } = picked;
    const live = picked.live || parseJobCard(card, 0);
    const merged = {
      ...inputJob,
      ...live,
      title: live.title || inputJob.title,
      company: live.company || inputJob.company,
      jobId: live.jobId || inputJob.jobId,
      href: live.href || inputJob.href
    };

    log("startChat matched via", picked.via, merged.title, "score=", picked.score, "jobId=", merged.jobId);

    const wrap = card.closest?.(".job-card-wrap") || card.closest?.("li.job-card-box") || card;
    try { wrap.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
    await sleep(160);
    preventLinkNavigation(wrap, 1800);

    const titleEl =
      wrap.querySelector?.("a.job-name, .job-name") ||
      card.querySelector?.("a.job-name, .job-name") ||
      null;
    if (titleEl) clickLikeHuman(titleEl);
    else clickLikeHuman(wrap);
    await sleep(550);

    if (!firstEl(SELECTORS.detailRoot) && !firstEl(SELECTORS.chatOnDetail)) {
      preventLinkNavigation(wrap, 1200);
      clickLikeHuman(titleEl || card || wrap);
      await sleep(500);
    }

    if (typeof detectLoginModal === "function") {
      const loginHit = detectLoginModal();
      if (loginHit.ok) {
        return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
      }
    }

    let clicked = { ok: false };
    for (let i = 0; i < 16; i++) {
      clicked = await clickChatButton();
      if (clicked.ok) break;
      const cardBtn = Array.from((wrap || card).querySelectorAll("a,button")).find((el) =>
        /立即沟通|继续沟通|打招呼/.test(textOf(el))
      );
      if (cardBtn) {
        preventLinkNavigation(wrap, 800);
        clickLikeHuman(cardBtn);
        clicked = { ok: true, buttonText: textOf(cardBtn), already: /继续沟通/.test(textOf(cardBtn)) };
        break;
      }
      if (i === 6) {
        preventLinkNavigation(wrap, 800);
        clickLikeHuman(titleEl || card || wrap);
      }
      await sleep(320);
    }

    if (!clicked.ok) {
      if (typeof detectLoginModal === "function") {
        const loginHit = detectLoginModal();
        if (loginHit.ok) {
          return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
        }
      }
      return {
        ok: false,
        error: "CHAT_BUTTON_NOT_FOUND",
        message: "未找到「立即沟通」按钮。请确认已登录，并手动点开该岗位看是否有沟通按钮",
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    await sleep(450);
    dismissCommonDialogs();
    if (typeof detectLoginModal === "function") {
      const loginHit = detectLoginModal();
      if (loginHit.ok) {
        return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
      }
    }

    const chatReady = await waitForChat(16000);
    if (!chatReady) {
      if (typeof detectLoginModal === "function") {
        const loginHit = detectLoginModal();
        if (loginHit.ok) {
          return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
        }
      }
      return {
        ok: false,
        error: "CHAT_TIMEOUT",
        message: "聊天输入框未出现。请确认已登录；如有弹窗请先处理",
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    const more = firstEl(SELECTORS.moreLink);
    const securityId = extractSecurityId(more?.href || "") || merged.securityId || "";
    const detailRoot = firstEl(SELECTORS.detailRoot) || document;
    const detailSalary = textOf(firstEl(SELECTORS.salary, detailRoot));

    return {
      ok: true,
      already: Boolean(clicked.already),
      job: { ...merged, securityId, salary: merged.salary || detailSalary },
      securityId,
      detailSalary,
      contentVersion: BHT_CONTENT_VERSION,
      matchedVia: picked.via,
      matchScore: picked.score
    };
  } finally {
      try { releaseNavGuard && releaseNavGuard(); } catch (_) {}
    }
  }


  function getSelfMessages(limit = 8) {
    const nodes = allEl(SELECTORS.selfMsg);
    const texts = nodes
      .map((el) => textOf(el))
      .filter((t) => t && t.length > 0);
    // 兜底：聊天页常见自己侧气泡
    if (!texts.length) {
      const extra = Array.from(
        document.querySelectorAll(
          ".message-item.item-myself, .item-myself, [class*='myself'], [class*='message-mine'], .chat-message.mine"
        )
      )
        .map((el) => textOf(el))
        .filter((t) => t && t.length > 1 && t.length < 500);
      texts.push(...extra);
    }
    return texts.slice(-Math.max(1, limit));
  }

  function findSendButton() {
    // 优先明确的发送按钮，避开「发简历/换电话」，且必须靠近聊天输入
    const input = getChatInput();
    const chatRoot =
      document.getElementById("bht-mock-chat") ||
      input?.closest?.(".chat-conversation, .chat-box, .conversation-box, .chat-container, .dialog-chat, .chat-input, .message-input, #chat-input") ||
      getChatRoot() ||
      null;
    const searchRoots = chatRoot ? [chatRoot, chatRoot.parentElement].filter(Boolean) : [];
    const collect = (root) =>
      Array.from(
        (root || document).querySelectorAll("button, a, div[role='button'], span.btn, .submit-button, .btn-send")
      );
    let nodes = [];
    for (const r of searchRoots) nodes.push(...collect(r));
    if (!nodes.length && input) {
      // 向上找一截容器
      let p = input.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        nodes.push(...collect(p));
        p = p.parentElement;
      }
    }
    if (!nodes.length) nodes = collect(document);
    const visible = nodes.filter((el) => {
      try {
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 8 && r.height > 8;
      } catch (_) {
        return true;
      }
    });
    const isSend = (el) => {
      const t = textOf(el);
      if (!/^(发送|发送消息|Send)$/i.test(t) && !/btn-send|submit-button/.test(el.className || "")) return false;
      if (/简历|电话|微信|表情|图片/.test(t)) return false;
      return true;
    };
    const exact = visible.find((el) => textOf(el) === "发送" || textOf(el) === "发送消息");
    if (exact && (chatRoot ? chatRoot.contains(exact) || !document.body.contains(chatRoot) : true)) return exact;
    const byClass = firstEl(SELECTORS.sendBtn, chatRoot || document);
    if (byClass) return byClass;
    return visible.find(isSend) || null;
  }

  async function setInputText(input, text) {
    if (!input) return false;
    try { input.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
    try { input.focus(); } catch (_) {}
    await sleep(80);

    const tag = (input.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "INPUT") {
      const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      try { desc?.set?.call(input, text); } catch (_) { input.value = text; }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // contenteditable（BOSS 聊天框）
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
      let inserted = false;
      try {
        inserted = document.execCommand("selectAll", false, null);
        inserted = document.execCommand("insertText", false, text) || inserted;
      } catch (_) {}
      if (!inserted) {
        try {
          input.innerHTML = "";
          input.textContent = text;
        } catch (_) {
          try { input.innerText = text; } catch (__) {}
        }
      }
      try {
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      } catch (_) {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // 再派发 composition 结束，兼容部分编辑器
      try {
        input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
      } catch (_) {}
    }
    await sleep(120);
    return true;
  }

  async function sendText(text, context = {}) {
    if (!text || !String(text).trim()) return { ok: false, error: "EMPTY_TEXT" };
    dismissCommonDialogs();
    let ready = await waitForChat(10000);
    if (!ready) {
      dismissCommonDialogs();
      await sleep(300);
      ready = await waitForChat(6000);
    }
    if (!ready) return { ok: false, error: "CHAT_TIMEOUT", message: "聊天输入框未就绪" };
    const input = getChatInput();
    if (!input || !hasUsableChatInput()) {
      return { ok: false, error: "INPUT_NOT_FOUND", message: "未找到可用聊天输入框" };
    }

    const before = getSelfMessages(24);
    await setInputText(input, text);
    await sleep(280);

    const written = (input.value || input.textContent || input.innerText || "").replace(/\s+/g, "");
    const needleFull = String(text).replace(/\s+/g, "");
    if (written.length < Math.min(4, needleFull.length)) {
      await setInputText(input, text);
      await sleep(220);
    }

    // 优先点「发送」；BOSS 聊天页默认 Enter 发送
    const sendBtn = findSendButton();
    if (sendBtn) {
      clickLikeHuman(sendBtn);
    } else {
      try { input.focus(); } catch (_) {}
      const fireKey = (opts) => {
        input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts }));
        input.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, ...opts }));
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...opts }));
      };
      fireKey({ key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    }

    const needle = needleFull;
    let confirmed = false;
    let selfTail = [];
    for (let i = 0; i < 25; i++) {
      await sleep(220);
      if (typeof detectLoginModal === "function") {
        const loginHit = detectLoginModal();
        if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message };
      }
      selfTail = getSelfMessages(24);
      // 只接受“自己的消息列表发生变化且出现预期文本”；输入框清空不能证明服务端已发送。
      confirmed = ConversationMatch?.confirmRenderedOwnMessage
        ? ConversationMatch.confirmRenderedOwnMessage(before, selfTail, needle)
        : false;
      if (confirmed) break;
    }

    if (!confirmed) {
      return {
        ok: false,
        error: "SEND_NOT_CONFIRMED",
        message: "未检测到消息发送成功。请确认聊天框可输入，或手动发送后点重试",
        selfTail
      };
    }
    const activeConversation = getActiveConversationIdentity();
    const sentAt = Date.now();
    const receipt = {
      type: "TEXT_SENT",
      status: "confirmed",
      receiptId: "text_" + sentAt + "_" + Math.random().toString(36).slice(2, 10),
      jobId: context.jobId || "",
      segmentIndex: Number.isInteger(context.segmentIndex) ? context.segmentIndex : null,
      conversationKey: context.conversationKey || activeConversation.key || "",
      confirmedVia: "self-message-dom",
      sentAt,
      contentVersion: BHT_CONTENT_VERSION
    };
    return {
      ok: true,
      confirmed: true,
      receipt,
      activeConversation,
      selfTail: selfTail.slice(-3),
      contentVersion: BHT_CONTENT_VERSION
    };
  }

  function getSelfMediaSignature(limit = 30) {
    const texts = getSelfMessages(limit).map((message) => String(message).replace(/\s+/g, " "));
    const roots = [
      document.getElementById("bht-mock-chat"),
      getChatRoot(),
      document
    ].filter(Boolean);
    let imgCount = 0;
    const imgHints = [];
    for (const root of roots) {
      try {
        const imgs = Array.from(
          root.querySelectorAll(
            ".item-myself img, .message-item.item-myself img, [class*='myself'] img, .chat-message.mine img, .message-mine img, .message-item.mine img"
          )
        );
        if (imgs.length > imgCount) {
          imgCount = imgs.length;
          imgHints.length = 0;
          imgs.slice(-8).forEach((img) => {
            const hint = img.currentSrc || img.src || img.getAttribute("src") || img.getAttribute("data-src") || "";
            if (hint) imgHints.push(hint.slice(-120));
          });
        }
      } catch (_) {}
    }
    return {
      textSignature: texts.join("\n"),
      textCount: texts.length,
      imgCount,
      imgHints: imgHints.join("|")
    };
  }

  function confirmImageSent(before, after) {
    if (!before || !after) return false;
    if (Number(after.imgCount || 0) > Number(before.imgCount || 0)) return "self-image-count";
    if ((after.imgHints || "") && after.imgHints !== (before.imgHints || "")) return "self-image-src";
    if ((after.textSignature || "") !== (before.textSignature || "")) {
      const beforeLines = new Set(String(before.textSignature || "").split("\n").filter(Boolean));
      const added = String(after.textSignature || "")
        .split("\n")
        .filter((line) => line && !beforeLines.has(line));
      if (added.some((line) => /图片|简历|\[图片\]|image|photo/i.test(line))) return "self-message-image-text";
      if (added.length > 0 && Number(after.textCount || 0) > Number(before.textCount || 0)) {
        return "self-message-added";
      }
    }
    return "";
  }

  async function waitForImageSendConfirm(before, via) {
    let after = before;
    let confirmedVia = "";
    // 图片上传比文本慢：15 秒内轮询，命中即返回（正常 1~2 秒内确认）
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      after = getSelfMediaSignature(30);
      confirmedVia = confirmImageSent(before, after);
      if (confirmedVia) break;
    }
    if (!confirmedVia) {
      return {
        ok: false,
        error: "IMAGE_SEND_NOT_CONFIRMED",
        message: "已触发图片上传，但聊天区未出现可验证的新图片消息",
        via,
        contentVersion: BHT_CONTENT_VERSION
      };
    }
    const sentAt = Date.now();
    const activeConversation = getActiveConversationIdentity();
    return {
      ok: true,
      confirmed: true,
      via,
      confirmedVia,
      receipt: {
        type: "IMAGE_SENT",
        status: "confirmed",
        receiptId: "image_" + sentAt + "_" + Math.random().toString(36).slice(2, 10),
        confirmedVia,
        via,
        sentAt,
        contentVersion: BHT_CONTENT_VERSION,
        conversationKey: activeConversation.key || ""
      },
      contentVersion: BHT_CONTENT_VERSION
    };
  }

  async function sendImageFromDataUrl(dataUrl, fileName = "resume.png") {
    if (!dataUrl) return { ok: false, error: "EMPTY_IMAGE" };
    dismissCommonDialogs();
    await waitForChat(8000);
    const chatRoot = getChatRoot() || document.getElementById("bht-mock-chat") || document;
    const before = getSelfMediaSignature(30);

    const findFileInput = () => {
      const roots = [chatRoot, document];
      for (const root of roots) {
        try {
          const list = Array.from(root.querySelectorAll("input[type='file']"));
          const prefer =
            list.find((el) => /image|png|jpg|jpeg|\*/i.test(el.getAttribute("accept") || "")) ||
            list[0];
          if (prefer) return prefer;
        } catch (_) {}
      }
      return null;
    };

    let input = findFileInput();
    if (!input) {
      const bar =
        (chatRoot.querySelector &&
          (chatRoot.querySelector(".chat-tool, .message-controls, .chat-footer, .chat-action, .conversation-footer") ||
            chatRoot)) ||
        document;
      const openers = Array.from(bar.querySelectorAll("button,a,div,i,span,label")).filter((el) => {
        const t = textOf(el);
        const aria = el.getAttribute?.("aria-label") || "";
        const title = el.getAttribute?.("title") || "";
        return /图片|相册|照片|发送图片/.test(t + aria + title);
      });
      for (const el of openers.slice(0, 3)) {
        try {
          clickLikeHuman(el);
          await sleep(320);
          input = findFileInput();
          if (input) break;
        } catch (_) {}
      }
    }
    if (!input) {
      for (let i = 0; i < 10 && !input; i++) {
        await sleep(280);
        input = findFileInput();
      }
    }

    if (!input) {
      try {
        const chatInput = getChatInput();
        if (chatInput && hasUsableChatInput()) {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          const file = new File([blob], fileName, { type: blob.type || "image/png" });
          const dt = new DataTransfer();
          dt.items.add(file);
          try { chatInput.focus(); } catch (_) {}
          const pasteEv = new Event("paste", { bubbles: true, cancelable: true });
          try { Object.defineProperty(pasteEv, "clipboardData", { value: dt }); } catch (_) {}
          chatInput.dispatchEvent(pasteEv);
          await sleep(700);
          const sendBtn = findSendButton();
          if (sendBtn) clickLikeHuman(sendBtn);
          return await waitForImageSendConfirm(before, "paste");
        }
      } catch (e) {
        log("image paste fail", e);
      }
      return {
        ok: false,
        error: "FILE_INPUT_NOT_FOUND",
        message: "未找到上传控件。请确认已打开聊天，或手动点图片发送简历",
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: blob.type || "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(1000);
      // BOSS 的发送按钮在附件未就绪时会处于 disabled：先等按钮真正可用再点，
      // 避免点击被吞导致图片从未送出（class 恒带 disabled 字样，只能看属性）。
      const btnReady = (btn) =>
        Boolean(btn) &&
        btn.disabled !== true &&
        btn.getAttribute("disabled") == null &&
        btn.getAttribute("aria-disabled") !== "true";
      let sendBtn = findSendButton();
      for (let i = 0; i < 10 && !btnReady(sendBtn); i++) {
        await sleep(400);
        sendBtn = findSendButton();
      }
      if (sendBtn) clickLikeHuman(sendBtn);
      const confirm = Array.from(document.querySelectorAll("button,a,.btn")).find(
        (el) => /发送|确定|完成/.test(textOf(el)) && !/取消|关闭/.test(textOf(el))
      );
      if (confirm && confirm !== sendBtn) {
        await sleep(300);
        clickLikeHuman(confirm);
      }
      return await waitForImageSendConfirm(before, "file-input");
    } catch (err) {
      return { ok: false, error: String(err?.message || err), contentVersion: BHT_CONTENT_VERSION };
    }
  }

  function highlightJobs(map = {}) {
    const cards = getJobCards();
    cards.forEach((card, index) => {
      const job = parseJobCard(card, index);
      const decision = map[job.jobId]?.decision;
      const wrap = card.closest?.(".job-card-wrap") || card;
      wrap.style.outline = "";
      wrap.style.outlineOffset = "";
      wrap.style.opacity = "";
      if (decision === "pass") {
        wrap.style.outline = "2px solid #22c55e";
        wrap.style.outlineOffset = "2px";
      } else if (decision === "reject") {
        wrap.style.outline = "1px dashed #94a3b8";
        wrap.style.opacity = "0.78";
      }
    });
    return { ok: true, count: cards.length };
  }

  
  function clickStayOnListDialog() {
    // BOSS 点击立即沟通后常见：留在此页 / 前往牛人/消息
    const candidates = Array.from(
      document.querySelectorAll("button,a,.btn,div[role='button'],span.btn,div.btn")
    ).filter((el) => {
      try {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
      } catch (_) {}
      return true;
    });
    const stay = candidates.find((el) => /留在此页|留在当前|继续停留|取消跳转/.test(textOf(el)));
    if (stay) {
      clickLikeHuman(stay);
      return { ok: true, text: textOf(stay) };
    }
    // 有的弹窗只有「继续沟通」在浮层里
    const cont = candidates.find((el) => textOf(el) === "继续沟通" || textOf(el) === "我知道了");
    if (cont) {
      clickLikeHuman(cont);
      return { ok: true, text: textOf(cont), soft: true };
    }
    return { ok: false };
  }

  function extractDetailHrName(scope) {
    const root =
      scope ||
      firstEl(SELECTORS.detailRoot) ||
      document.querySelector(".job-detail, .job-detail-box, .job-detail-container") ||
      document;
    const sels = [
      ".job-boss-info .name",
      ".job-boss-info h2.name",
      ".boss-info-attr .name",
      ".info-public .name",
      ".detail-figure .name",
      ".job-detail .name",
      ...(SELECTORS.hrName || [])
    ];
    for (const sel of sels) {
      try {
        const el = root.querySelector(sel);
        const raw = textOf(el);
        const t = ConversationMatch?.cleanHrIdentity
          ? ConversationMatch.cleanHrIdentity(raw)
          : raw.split(/[·|｜]/)[0].replace(/\s+/g, " ").trim();
        if (t && t.length <= 20 && !/立即沟通|继续沟通|沟通/.test(t)) return t;
      } catch (_) {}
    }
    return "";
  }

  function parseBossActiveLabel(text = "") {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    const match = t.match(/((?:刚刚|今日|本周|本月|两周内|半年前|半年内|一年前|1年前|\d+日前|\d+日内|\d+周内|\d+月内)活跃|当前在线)/);
    if (match) return match[1] === "当前在线" ? "在线" : match[1];
    if (/(^|[^0-9\u4e00-\u9fff])在线([^0-9\u4e00-\u9fff]|$)/.test(t) && !/活跃/.test(t)) return "在线";
    return "";
  }

  function extractDetailActiveText(scope) {
    const root =
      scope ||
      firstEl(SELECTORS.detailRoot) ||
      document.querySelector(".job-detail, .job-detail-box, .job-detail-container") ||
      document;
    const boss = root.querySelector?.(".job-boss-info") || root;
    return parseBossActiveLabel(textOf(boss.querySelector?.(".boss-online-tag, .online-tag"))) ||
      parseBossActiveLabel(textOf(boss.querySelector?.(".boss-active-time"))) ||
      parseBossActiveLabel(textOf(firstEl(SELECTORS.activeText, root))) ||
      parseBossActiveLabel(textOf(boss));
  }

  function extractDetailHunter(scope) {
    const root =
      scope ||
      firstEl(SELECTORS.detailRoot) ||
      document.querySelector(".job-detail, .job-detail-box, .job-detail-container") ||
      document;
    const attr = textOf(root.querySelector?.(".job-boss-info .boss-info-attr, .boss-info-attr"));
    const html = String(root.querySelector?.(".job-boss-info")?.innerHTML || "");
    const goldHunter = /猎头/.test(attr) || /gold-hunter|goldHunter|icon-gold-hunter/.test(html);
    return {
      goldHunter,
      hrTitle: attr.split(/[·|｜]/).slice(1).join(" · ").trim() || attr
    };
  }

  function findJobCard(job = {}) {
    const jobId = String(job.jobId || "");
    const title = normalizeText(job.title || "");
    const cards = getJobCards();
    for (const card of cards) {
      const href = card.querySelector?.("a.job-name[href], a[href*='job_detail']")?.href ||
        card.getAttribute?.("data-jobid") ||
        "";
      const cardId = extractJobIdFromHref(href) ||
        card.getAttribute?.("data-jobid") ||
        card.getAttribute?.("data-job-id") ||
        "";
      if (jobId && cardId && String(cardId) === jobId) return card;
    }
    for (const card of cards) {
      const cardTitle = normalizeText(textOf(card.querySelector?.("a.job-name, .job-name")));
      if (title && cardTitle && cardTitle === title) return card;
    }
    return null;
  }

  async function inspectListSideDetail(job = {}, deadlineAt = 0) {
    const card = findJobCard(job);
    if (!card) return { ok: false, skipped: true, error: "JOB_CARD_NOT_FOUND" };
    const clickTarget = card.querySelector("a.job-name, .job-name") || card;
    clickLikeHuman(clickTarget);
    const expectedJobId = String(job.jobId || "");
    const expectedTitle = normalizeText(job.title || "");
    let last = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (deadlineAt && Date.now() >= deadlineAt) break;
      const root =
        firstEl(SELECTORS.detailRoot) ||
        document.querySelector(".job-detail-box, .job-detail-container, .job-detail");
      const detailTitle = textOf(firstEl(SELECTORS.title, root || document)) ||
        textOf(document.querySelector(".job-detail-box .job-name, .job-detail .job-name, h1.job-name"));
      const detailHref =
        root?.querySelector?.("a.more-job-btn[href*='job_detail'], a[href*='job_detail']")?.href || "";
      const actualJobId = extractJobIdFromHref(detailHref);
      const identityMatches = Boolean(
        root && (
          (expectedJobId && actualJobId && expectedJobId === actualJobId) ||
          (expectedTitle && normalizeText(detailTitle) === expectedTitle)
        )
      );
      const network = jobNetworkMetadata.get(expectedJobId) || {};
      const hunter = extractDetailHunter(root || document);
      const activeText = identityMatches
        ? (extractDetailActiveText(root) || network.activeText || "")
        : String(network.activeText || "");
      last = { identityMatches, activeText, hunter, actualJobId, detailTitle };
      const activeLabel = parseBossActiveLabel(activeText);
      if (identityMatches && (activeLabel || hunter.goldHunter)) {
        const hrName = extractDetailHrName(root) || job.hrName || job.bossName || "";
        rememberJobNetworkMetadata({
          jobId: expectedJobId || actualJobId,
          activeText: activeLabel,
          goldHunter: hunter.goldHunter,
          bossTitle: hunter.hrTitle,
          bossName: hrName,
          source: "list-side-detail"
        });
        return {
          ok: true,
          jobId: expectedJobId || actualJobId,
          activeText: activeLabel,
          bossOnline: activeLabel === "在线",
          bossName: hrName,
          goldHunter: hunter.goldHunter === true || network.goldHunter === true,
          hrTitle: hunter.hrTitle || network.bossTitle || "",
          source: "list-side-detail"
        };
      }
      await sleep(80);
    }
    return {
      ok: false,
      error: last?.identityMatches ? "DETAIL_ACTIVE_UNKNOWN" : "DETAIL_IDENTITY_MISMATCH",
      activeText: last?.activeText || "",
      jobId: last?.actualJobId || expectedJobId
    };
  }

  function extractDetailCompany(scope) {
    const root =
      scope ||
      firstEl(SELECTORS.detailRoot) ||
      document.querySelector(".job-detail, .job-detail-box, .job-detail-container") ||
      document;
    const structured =
      textOf(firstEl(SELECTORS.company, root)) ||
      textOf(root.querySelector?.(".company-name, .company-info .name"));
    if (structured) return structured;
    const attr = textOf(root.querySelector?.(".job-boss-info .boss-info-attr, .boss-info-attr"));
    return String(attr || "").split(/[·|｜]/)[0].trim();
  }

  async function inspectWorkerJobDetail(job = {}) {
    const expectedJobId = String(job.jobId || "");
    const expectedTitle = normalizeText(job.title || "");
    let last = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const root =
        firstEl(SELECTORS.detailRoot) ||
        document.querySelector(".job-detail, .job-detail-box, .job-detail-container");
      const detailHref =
        (/\/job_detail\//i.test(location.pathname) ? location.href : "") ||
        (root?.querySelector?.("a.more-job-btn[href*='job_detail'], a[href*='job_detail']")?.href || "");
      const actualJobId = extractJobIdFromHref(detailHref);
      const detailTitle = textOf(firstEl(SELECTORS.title, root || document)) ||
        textOf(document.querySelector(".job-detail .job-name, .job-detail-box .job-name, h1.job-name"));
      const normalizedDetailTitle = normalizeText(detailTitle || "");
      const identityMatches = Boolean(
        root && (
          (expectedJobId && actualJobId && expectedJobId === actualJobId) ||
          (!actualJobId && expectedTitle && normalizedDetailTitle === expectedTitle) ||
          (!expectedJobId && expectedTitle && normalizedDetailTitle === expectedTitle)
        )
      );
      last = { root, detailHref, actualJobId, detailTitle, identityMatches };
      if (identityMatches) {
        const activeText = extractDetailActiveText(root);
        if (activeText) {
          const result = {
            ok: true,
            activeText,
            jobId: actualJobId || expectedJobId,
            title: detailTitle || job.title || "",
            company: extractDetailCompany(root) || job.company || "",
            hrName: extractDetailHrName(root) || job.hrName || job.bossName || "",
            contentVersion: BHT_CONTENT_VERSION
          };
          debugTrace("worker_detail_activity_ready", result);
          return result;
        }
      }
      await sleep(125);
    }
    const result = {
      ok: Boolean(last?.identityMatches),
      error: last?.identityMatches ? "DETAIL_ACTIVE_UNKNOWN" : "DETAIL_IDENTITY_MISMATCH",
      activeText: "",
      jobId: last?.actualJobId || "",
      title: last?.detailTitle || "",
      message: last?.identityMatches
        ? "岗位详情未提供 HR 活跃时间"
        : "临时详情页与待投岗位不一致",
      contentVersion: BHT_CONTENT_VERSION
    };
    debugTrace("worker_detail_activity_unavailable", result, "warn");
    return result;
  }

  // 岗位详情页内点击「立即沟通」后，BOSS 会 SPA 跳转/整页刷新到会话页；
  // 检测是否已开始离开详情页（此时应由导航恢复逻辑收尾，本页不再重复操作）。
  function isConversationNavigationStarted() {
    return !/\/job_detail\//i.test(location.pathname) || document.readyState === "loading";
  }

  async function triggerConversationOnWorkerDetail(job = {}) {
    debugTrace("worker_detail_trigger_begin", {
      job: {
        jobId: job.jobId || "",
        title: job.title || "",
        company: job.company || "",
        href: job.href || ""
      },
      page: pageInfo()
    });
    dismissCommonDialogs();
    if (typeof detectLoginModal === "function") {
      const loginHit = detectLoginModal();
      if (loginHit.ok) {
        return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
      }
    }

    const nativeReceiptStartedAt = Date.now();
    let clicked = { ok: false, buttonText: "", already: false };
    let detailTitle = "";

    // 就绪门：岗位详情是重型 SPA，按钮 DOM 可能先于 BOSS 事件绑定出现；
    // 页面未渲染完整时点击只会无效，随后苦等超时「卡住」。页面就绪判据：
    //  1) 岗位标题 + 按钮同时出现（最可靠）；或
    //  2) 文档加载完成且按钮连续存在 ≥1.5s（标题选择器未命中的布局兜底）。
    // 非详情页（复用标签停在旧页/已跳转）稳定 ≥1.5s 快速失败，不空等 12s。
    const renderGateAt = Date.now();
    const RENDER_GATE_MS = 12000;
    const BUTTON_STABLE_MS = 1500;
    const WRONG_PAGE_GRACE_MS = 1500;
    let pageUsable = false;
    let scopeRoot = document;
    let gateBtn = null;
    let btnFirstSeenAt = 0;
    let nonDetailAt = 0;
    for (;;) {
      const isDetailPage = /\/job_detail\//i.test(location.pathname);
      const nowMs = Date.now();
      if (isDetailPage) {
        nonDetailAt = 0;
        const scope =
          firstEl(SELECTORS.detailRoot) ||
          document.querySelector(".job-detail, .job-detail-box, .job-detail-container") ||
          document;
        const title = textOf(firstEl(SELECTORS.title, scope)) ||
          textOf(document.querySelector(".job-detail .job-name, .job-detail-box .job-name, h1.job-name")) ||
          "";
        gateBtn = findConversationActionButton(scope);
        if (gateBtn && !btnFirstSeenAt) btnFirstSeenAt = nowMs;
        const loginHit = typeof detectLoginModal === "function" ? detectLoginModal() : null;
        if (loginHit?.ok) {
          return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
        }
        const btnStable = gateBtn && (nowMs - btnFirstSeenAt) >= BUTTON_STABLE_MS;
        if (document.readyState === "complete" && gateBtn && (title || btnStable)) {
          pageUsable = true;
          scopeRoot = scope;
          detailTitle = title;
          break;
        }
      } else if (!nonDetailAt) {
        nonDetailAt = nowMs;
      }
      // 稳定非详情页（旧页/跳转后页）：宽限 1.5s 后立即失败，交给兜底/导航恢复
      if (!isDetailPage && nonDetailAt && (nowMs - nonDetailAt) >= WRONG_PAGE_GRACE_MS) {
        break;
      }
      if (nowMs - renderGateAt >= RENDER_GATE_MS) {
        if (!isDetailPage) {
          // 点击已触发页面跳转：交给导航恢复逻辑，不在此报错
          break;
        }
        const notReady = {
          ok: false,
          error: "WORKER_PAGE_NOT_READY",
          message: "岗位详情页长时间未渲染完成（页面加载慢或可能被 BOSS 限流），已自动跳过该岗位",
          detailTitle,
          href: location.href,
          page: pageInfo(),
          contentVersion: BHT_CONTENT_VERSION
        };
        debugTrace("worker_detail_page_not_ready", notReady, "warn");
        return notReady;
      }
      await sleep(250);
    }
    if (!pageUsable) {
      // 页面已跳转（点击前）：无按钮可点，交给导航恢复；直接返回未知态避免卡死
      if (!clicked.ok) {
        const unknown = {
          ok: false,
          error: "WORKER_CHAT_BUTTON_NOT_FOUND",
          message: "临时执行页已离开岗位详情（可能已跳转），等待导航恢复",
          detailTitle,
          href: location.href,
          contentVersion: BHT_CONTENT_VERSION
        };
        debugTrace("worker_detail_chat_button_not_found", unknown, "warn");
        return unknown;
      }
    } else {
      const btn = gateBtn || findConversationActionButton(scopeRoot);
      if (!btn) {
        const missing = {
          ok: false,
          error: "WORKER_CHAT_BUTTON_NOT_FOUND",
          message: "临时执行页未找到「立即沟通」按钮",
          detailTitle,
          href: location.href,
          contentVersion: BHT_CONTENT_VERSION
        };
        debugTrace("worker_detail_chat_button_not_found", missing, "warn");
        return missing;
      }
      const buttonText = textOf(btn);
      const clickOk = clickLikeHuman(btn);
      clicked = { ok: clickOk, buttonText, already: /继续沟通/.test(buttonText) };
      window.__BHT_LAST_TRIGGER_CLICK__ = {
        at: Date.now(),
        jobId: String(job.jobId || job.encryptJobId || ""),
        buttonText,
        already: clicked.already,
        detailTitle: detailTitle || job.title || "",
        hrName: extractDetailHrName(scopeRoot) || job.hrName || job.bossName || "",
        company: extractDetailCompany(scopeRoot) || job.company || "",
        title: detailTitle || job.title || "",
        listHref: job.listHref || ""
      };
      debugTrace("worker_detail_chat_button_clicked", {
        buttonText,
        clickOk,
        button: describeDebugElement(btn),
        page: pageInfo()
      }, clickOk ? "debug" : "error");
    }

    const isDetailPageNow = () => /\/job_detail\//i.test(location.pathname);
    if (!clicked.ok && !isDetailPageNow()) {
      // 点击后页面已跳转：无按钮可点，交给导航恢复
      const unknown = {
        ok: false,
        error: "WORKER_CHAT_BUTTON_NOT_FOUND",
        message: "临时执行页已离开岗位详情（可能已跳转），等待导航恢复",
        detailTitle,
        href: location.href,
        contentVersion: BHT_CONTENT_VERSION
      };
      debugTrace("worker_detail_chat_button_not_found", unknown, "warn");
      return unknown;
    }

    if (!clicked.ok) {
      if (typeof detectLoginModal === "function") {
        const loginHit = detectLoginModal();
        if (loginHit.ok) {
          return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
        }
      }
      const missing = {
        ok: false,
        error: "WORKER_CHAT_BUTTON_NOT_FOUND",
        message: "临时执行页未找到「立即沟通」按钮",
        detailTitle,
        href: location.href,
        contentVersion: BHT_CONTENT_VERSION
      };
      debugTrace("worker_detail_chat_button_not_found", missing, "warn");
      return missing;
    }

    // 自动招呼开启时仍可能出现“留在此页”；执行页停留或跳转都不会影响左侧真实列表。
    let stay = { ok: false };
    for (let i = 0; i < 18 && !stay.ok; i++) {
      stay = clickStayOnListDialog();
      if (!stay.ok) await sleep(50);
    }
    dismissCommonDialogs();
    let nativeGreeting = clicked.already
      ? { available: false, showGreeting: null, text: "", source: "already-contacted" }
      : await waitForNativeGreetingReceipt(job, nativeReceiptStartedAt, 3200);

    if (!clicked.already && !nativeGreeting.available) {
      // 无回执且页面既未跳转也未弹窗：BOSS 事件绑定可能晚于 DOM 出现，补点一次后仍无效果才快速失败
      const retryScope =
        firstEl(SELECTORS.detailRoot) ||
        document.querySelector(".job-detail, .job-detail-box, .job-detail-container") ||
        document;
      const retryBtn = findConversationActionButton(retryScope);
      const retryText = retryBtn ? textOf(retryBtn) : "";
      const noDialog = typeof detectLoginModal !== "function" || !detectLoginModal().ok;
      const stillOnDetail = isDetailPageNow() && !isConversationNavigationStarted();
      if (retryBtn && retryText === clicked.buttonText && noDialog && stillOnDetail) {
        debugTrace("worker_detail_click_retry", {
          reason: "no-receipt-no-navigation",
          buttonText: retryText,
          page: pageInfo()
        }, "warn");
        clickLikeHuman(retryBtn);
        // afterTs 与首次等待尾部重叠，避免回执恰好在两次等待之间到达被漏掉
        const retryGreeting = await waitForNativeGreetingReceipt(job, nativeReceiptStartedAt + 2500, 4200);
        if (retryGreeting.available) {
          nativeGreeting = retryGreeting;
        } else if (!stillOnDetail || isConversationNavigationStarted()) {
          // 补点后开始跳转：由导航恢复收尾，本页按成功进入下一阶段（消息页会做最终核对）
          nativeGreeting = { available: true, showGreeting: null, text: "", source: "navigation-recovery" };
        } else {
          const noEffect = {
            ok: false,
            error: "WORKER_CHAT_CLICK_NO_EFFECT",
            message: "已点击「立即沟通」但 BOSS 一直未响应（页面加载未完成或触发未生效），已自动跳过该岗位",
            buttonText: clicked.buttonText,
            detailTitle: detailTitle || job.title || "",
            href: location.href,
            page: pageInfo(),
            contentVersion: BHT_CONTENT_VERSION
          };
          debugTrace("worker_detail_click_no_effect", noEffect, "error");
          return noEffect;
        }
      } else if (!stillOnDetail) {
        // 点击后开始跳转：由导航恢复收尾，本页不返回失败
        nativeGreeting = { available: true, showGreeting: null, text: "", source: "navigation-recovery" };
      } else {
        const unconfirmed = {
          ok: false,
          error: "CONVERSATION_CREATE_NOT_CONFIRMED",
          message: "已尝试点击「立即沟通」，但未收到 BOSS 创建会话成功回执；已停止，避免误报成功",
          buttonText: clicked.buttonText,
          detailTitle: detailTitle || job.title || "",
          href: location.href,
          nativeGreeting,
          contentVersion: BHT_CONTENT_VERSION
        };
        debugTrace("worker_detail_trigger_unconfirmed", unconfirmed, "error");
        return unconfirmed;
      }
    }
    const result = {
      ok: true,
      phase: "CHAT_TRIGGERED",
      workerDetail: true,
      buttonText: clicked.buttonText,
      already: Boolean(clicked.already),
      stayed: Boolean(stay.ok),
      nativeGreeting,
      stayText: stay.text || "",
      detailTitle: detailTitle || job.title || "",
      hrName: extractDetailHrName() || job.hrName || job.bossName || "",
      bossName: extractDetailHrName() || job.hrName || job.bossName || "",
      company: extractDetailCompany() || job.company || "",
      title: detailTitle || job.title || "",
      listHref: job.listHref || "",
      href: location.href,
      contentVersion: BHT_CONTENT_VERSION
    };
    debugTrace("worker_detail_trigger_done", result);
    return result;
  }

  async function triggerConversationOnList(job = {}) {
    debugTrace("trigger_conversation_begin", {
      job: {
        jobId: job.jobId || "",
        title: job.title || "",
        company: job.company || "",
        hrName: job.hrName || job.bossName || ""
      },
      page: { title: document.title, cards: getJobCards().length }
    });
    try { rememberListHref(); } catch (_) {}
    dismissCommonDialogs();
    if (typeof detectLoginModal === "function") {
      const loginHit = detectLoginModal();
      if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
    }

    const ensureResult = await ensureJobList({ maxWaitMs: 8000, scroll: true, noHomeNav: true });
    debugTrace("trigger_list_ready", {
      ensureResult,
      page: pageInfo(),
      cardCount: getJobCards().length
    }, ensureResult?.ok === false ? "warn" : "debug");
    let card = findCardByJob(job);
    let cardFoundVia = card ? "current-dom" : "";
    if (!card) {
      try {
        card = await findCardByScrolling(job, 50);
        if (card) cardFoundVia = "scroll-search";
      } catch (error) {
        debugTrace("trigger_card_scroll_search_error", { error: serializeDebugError(error) }, "error");
      }
    }
    if (!card) {
      const samples = getJobCards().slice(0, 5).map((el, i) => parseJobCard(el, i).title).filter(Boolean);
      debugTrace("trigger_conversation_job_not_found", {
        requested: { title: job.title || "", company: job.company || "", jobId: job.jobId || "" },
        cardCount: getJobCards().length,
        samples
      }, "warn");
      return {
        ok: false,
        error: "LIST_JOB_NOT_FOUND",
        message: "列表中找不到岗位「" + (job.title || "") + "」",
        samples,
        listCount: getJobCards().length,
        href: location.href,
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    debugTrace("trigger_card_found", {
      via: cardFoundVia,
      requested: { jobId: job.jobId || "", title: job.title || "", company: job.company || "" },
      parsed: parseJobCard(card, Math.max(0, getJobCards().indexOf(card))),
      element: describeDebugElement(card)
    });

    const release = installJobNavGuard(12000);
    try {
      const wrap = card.closest?.(".job-card-wrap, li, .job-card-box") || card;
      debugTrace("trigger_card_click_stage", {
        stage: "card",
        element: describeDebugElement(wrap),
        detailBefore: {
          title: textOf(firstEl(SELECTORS.title, firstEl(SELECTORS.detailRoot) || document)),
          hrName: extractDetailHrName(),
          company: extractDetailCompany()
        }
      });
      try { wrap.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
      await sleep(200);
      // 点卡片切换右侧详情（拦截整页跳转）
      preventLinkNavigation(wrap, 1500);
      clickLikeHuman(wrap);
      await sleep(700);

      // 再点一次标题区域提高详情刷新概率
      const titleEl = firstEl(SELECTORS.title, wrap) || wrap;
      debugTrace("trigger_card_click_stage", { stage: "title", element: describeDebugElement(titleEl) });
      preventLinkNavigation(wrap, 1500);
      clickLikeHuman(titleEl);
      await sleep(600);

      // 验证右侧详情大致匹配
      const detailTitle =
        textOf(firstEl(SELECTORS.title, firstEl(SELECTORS.detailRoot) || document)) ||
        textOf(document.querySelector(".job-detail .job-name, .job-detail-box .job-name, .job-name"));
      const want = normalizeText(job.title || "");
      const got = normalizeText(detailTitle || "");
      const titleOk = !want || !got || got.includes(want.slice(0, 8)) || want.includes(got.slice(0, 8));
      debugTrace("trigger_detail_identity", {
        requested: { title: job.title || "", company: job.company || "", hrName: job.hrName || job.bossName || "" },
        extracted: {
          title: detailTitle || "",
          company: extractDetailCompany(),
          hrName: extractDetailHrName()
        },
        normalized: { want, got },
        titleOk,
        detailRoot: describeDebugElement(firstEl(SELECTORS.detailRoot))
      }, titleOk ? "debug" : "warn");
      if (!titleOk) {
        log("list detail title weak match", { want: job.title, got: detailTitle });
      }

      // 点立即沟通 / 继续沟通（详情区优先）
      let clicked = { ok: false };
      const nativeReceiptStartedAt = Date.now();
      for (let i = 0; i < 14; i++) {
        const scope =
          firstEl(SELECTORS.detailRoot) ||
          document.querySelector(".job-detail, .job-detail-box, .job-detail-container") ||
          document;
        const btn = findConversationActionButton(scope);
        debugTrace("trigger_chat_button_probe", {
          attempt: i + 1,
          found: Boolean(btn),
          button: describeDebugElement(btn),
          scope: describeDebugElement(scope),
          selectorCounts: {
            detailButtons: allEl(SELECTORS.chatOnDetail, scope).length,
            textCandidates: Array.from(scope.querySelectorAll("a,button,[role='button']"))
              .filter((el) => /^(立即沟通|继续沟通|打招呼)$/.test(textOf(el).replace(/\s+/g, " ").trim())).length
          }
        }, btn ? "debug" : "warn");
        if (btn) {
          const buttonText = textOf(btn);
          const clickOk = clickLikeHuman(btn);
          clicked = { ok: clickOk, buttonText, already: /继续沟通/.test(buttonText) };
          window.__BHT_LAST_TRIGGER_CLICK__ = {
            at: Date.now(),
            jobId: String(job.jobId || job.encryptJobId || ""),
            buttonText,
            already: clicked.already,
            detailTitle: detailTitle || job.title || "",
            hrName: extractDetailHrName() || job.hrName || job.bossName || "",
            company: extractDetailCompany() || job.company || "",
            title: detailTitle || job.title || "",
            listHref: location.href
          };
          debugTrace("trigger_chat_button_clicked", {
            buttonText,
            clickOk,
            button: describeDebugElement(btn)
          }, clickOk ? "debug" : "error");
          break;
        }
        await sleep(280);
      }
      if (!clicked.ok) {
        if (typeof detectLoginModal === "function") {
          const loginHit = detectLoginModal();
          if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
        }
        const missingButton = {
          ok: false,
          error: "CHAT_BUTTON_NOT_FOUND",
          message: "列表详情区未找到「立即沟通」按钮",
          detailTitle,
          href: location.href,
          contentVersion: BHT_CONTENT_VERSION
        };
        debugTrace("trigger_chat_button_not_found", missingButton, "error");
        return missingButton;
      }

      // 弹层有时只出现 100~300ms，BOSS 随后就会整页进入聊天；高频短轮询避免固定等待 450ms 错过它。
      let stay = { ok: false };
      for (let i = 0; i < 18 && !stay.ok; i++) {
        stay = clickStayOnListDialog();
        if (!stay.ok) await sleep(50);
      }
      debugTrace("trigger_stay_on_list_dialog", { result: stay, page: pageInfo() }, stay.ok ? "debug" : "warn");
      // 再关一次常见弹层
      dismissCommonDialogs();
      const nativeGreeting = clicked.already
        ? { available: false, showGreeting: null, text: "", source: "already-contacted" }
        : await waitForNativeGreetingReceipt(job, nativeReceiptStartedAt, 3200);
      if (!clicked.already && !nativeGreeting.available) {
        return {
          ok: false,
          error: "CONVERSATION_CREATE_NOT_CONFIRMED",
          message: "已尝试点击「立即沟通」，但未收到 BOSS 创建会话成功回执；已停止，避免误报成功",
          buttonText: clicked.buttonText,
          detailTitle: detailTitle || "",
          href: location.href,
          nativeGreeting,
          contentVersion: BHT_CONTENT_VERSION
        };
      }

      const triggerResult = {
        ok: true,
        phase: "CHAT_TRIGGERED",
        buttonText: clicked.buttonText,
        already: Boolean(clicked.already),
        stayed: Boolean(stay.ok),
        nativeGreeting,
        stayText: stay.text || "",
        detailTitle: detailTitle || "",
        hrName: (typeof extractDetailHrName === "function" ? extractDetailHrName() : "") || job.hrName || job.bossName || "",
        bossName: (typeof extractDetailHrName === "function" ? extractDetailHrName() : "") || job.hrName || job.bossName || "",
        company: (typeof extractDetailCompany === "function" ? extractDetailCompany() : "") || job.company || "",
        title: detailTitle || job.title || "",
        listHref: location.href,
        contentVersion: BHT_CONTENT_VERSION
      };
      debugTrace("trigger_conversation_done", triggerResult);
      return triggerResult;
    } catch (error) {
      const failed = {
        ok: false,
        error: "TRIGGER_CONVERSATION_EXCEPTION",
        message: String(error?.message || error || "触发沟通异常"),
        diagnostic: {
          error: serializeDebugError(error),
          page: pageInfo(),
          activeElement: describeDebugElement(document.activeElement),
          card: describeDebugElement(card)
        },
        contentVersion: BHT_CONTENT_VERSION
      };
      debugTrace("trigger_conversation_exception", failed, "error");
      return failed;
    } finally {
      try { release && release(); } catch (_) {}
    }
  }

  
  const ConversationMatch = globalThis.BHTConversationMatch;
  const CONV_ROW_SELECTORS = [
    ".user-list .user-list-content .friend-content-warp > .friend-content",
    ".user-list .friend-content-warp > .friend-content",
    ".friend-content-warp > .friend-content",
    ".user-list .friend-content",
    ".friend-content",
    ".geek-chat-list li",
    ".chat-user-list li",
    ".friend-list-item",
    ".user-list li",
    "[class*='friend-list'] li",
    "[class*='chat-list'] li",
    ".chat-container .user-list .user-item",
    "div[class*='conversation'] li",
    ".chat-left li"
  ];

  function conversationIdentityText(el) {
    if (!el) return "";
    const fields = [
      ".friend-name",
      ".user-name",
      ".boss-name",
      ".name-text",
      ".name-box",
      ".name",
      ".company-name",
      ".company",
      ".job-name",
      ".position-name",
      ".position"
    ];
    const values = [];
    for (const selector of fields) {
      try {
        for (const node of el.querySelectorAll(selector)) {
          const value = textOf(node);
          if (value && !values.includes(value)) values.push(value);
        }
      } catch (_) {}
    }
    if (values.length) return values.slice(0, 5).join("|");
    return String(el.innerText || el.textContent || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(今天|昨天|前天|\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日|\d+)$/.test(line))
      .slice(0, 3)
      .join("|");
  }

  function conversationKeyFromEl(el) {
    if (!el) return "";
    const a = el.closest?.("a[href]") || el.querySelector?.("a[href]") || (el.tagName === "A" ? el : null);
    const href = a?.href || a?.getAttribute?.("href") || "";
    const carriers = [
      el,
      el.closest?.(".friend-content-warp"),
      el.parentElement,
      el.parentElement?.parentElement
    ].filter(Boolean);
    let dataId = "";
    for (const carrier of carriers) {
      dataId =
        carrier.getAttribute?.("data-id") ||
        carrier.getAttribute?.("data-uid") ||
        carrier.getAttribute?.("data-boss-id") ||
        carrier.getAttribute?.("data-convid") ||
        carrier.getAttribute?.("data-conversation-id") ||
        carrier.getAttribute?.("data-friend-id") ||
        carrier.dataset?.id ||
        carrier.dataset?.uid ||
        carrier.dataset?.bossId ||
        carrier.dataset?.conversationId ||
        carrier.dataset?.friendId ||
        "";
      if (dataId) break;
    }
    const identityText = conversationIdentityText(el);
    const text = textOf(el);
    if (ConversationMatch?.stableConversationKey) {
      return ConversationMatch.stableConversationKey({ dataId, href, identityText, text });
    }
    return String(dataId || href || identityText || text.slice(0, 80));
  }

  function queryConversationRows() {
    for (const sel of CONV_ROW_SELECTORS) {
      try {
        const list = Array.from(document.querySelectorAll(sel)).filter((el, index, all) => {
          if (!el || all.indexOf(el) !== index || el.getAttribute?.("aria-hidden") === "true") return false;
          const text = textOf(el);
          return text.length > 1;
        });
        if (list.length >= 1) return { sel, nodes: list };
      } catch (_) {}
    }
    const fallback = Array.from(document.querySelectorAll(".chat-left li, .chat-box li, aside li")).slice(0, 80);
    return { sel: "fallback", nodes: fallback };
  }

  function getActiveConversationIdentity() {
    const { nodes } = queryConversationRows();
    const active =
      nodes.find((el) => ConversationMatch?.hasActiveState
        ? ConversationMatch.hasActiveState(el.className || "", el.getAttribute?.("aria-selected"))
        : /(^|\s)(active|selected|current|on)(\s|$)/i.test(el.className || "")) ||
      null;
    const headEl =
      document.querySelector(".chat-top, .chat-header, .conversation-header, .base-info-single, .chat-main .base-info, .chat-person, .base-info") ||
      null;
    const head = textOf(headEl);
    return {
      key: active ? conversationKeyFromEl(active) : "",
      text: active ? textOf(active).slice(0, 120) : "",
      head: head.slice(0, 160),
      href: location.href
    };
  }

  function conversationHeaderMatches(job = {}) {
    const active = getActiveConversationIdentity();
    const head = normalizeText((active.head || "") + " " + (active.text || ""));
    if (!head) return false;
    const wantCompany = normalizeText(job.company || "");
    const wantTitle = normalizeText(job.title || "");
    const wantHr = normalizeText(job.hrName || job.bossName || "");
    const companyHit = Boolean(wantCompany && head.includes(wantCompany.slice(0, Math.min(3, wantCompany.length))));
    const titleHit = Boolean(wantTitle && head.includes(wantTitle.slice(0, Math.min(4, wantTitle.length))));
    const hrHit = Boolean(wantHr && (head.includes(wantHr) || head.includes(wantHr.slice(0, Math.min(2, wantHr.length)))));
    // 有 HR 时：公司+HR 或 HR+岗位 才算稳
    if (wantHr) return (companyHit && hrHit) || (hrHit && titleHit) || (companyHit && titleHit && hrHit);
    // 无 HR：公司或岗位命中
    return companyHit || titleHit;
  }

  function getConversationSnapshot() {
    const { sel, nodes } = queryConversationRows();
    const items = nodes.slice(0, 60).map((el, index) => {
      const text = textOf(el);
      const identityText = typeof conversationIdentityText === "function" ? conversationIdentityText(el) : "";
      const key = conversationKeyFromEl(el) || ("idx_" + index + "_" + text.slice(0, 24));
      const hrRaw =
        textOf(el.querySelector?.(".friend-name, .user-name, .boss-name, .name-text, .name-box .name")) ||
        (identityText.split("|")[0] || "");
      const company = textOf(el.querySelector?.(".company-name, .company, .company-text")) || "";
      const title = textOf(el.querySelector?.(".job-name, .position-name, .position, .source-job")) || "";
      const hrName = ConversationMatch?.cleanHrIdentity
        ? ConversationMatch.cleanHrIdentity(hrRaw)
        : String(hrRaw || "").split(/[·|｜]/)[0].trim();
      return {
        index,
        key,
        text: text.slice(0, 160),
        identityText: String(identityText || "").slice(0, 160),
        hrName,
        bossName: hrName,
        company: String(company || "").trim(),
        title: String(title || "").trim(),
        name: text.split(/\s+/)[0] || "",
        active: ConversationMatch?.hasActiveState
          ? ConversationMatch.hasActiveState(el.className || "", el.getAttribute?.("aria-selected"))
          : /(^|\s)(active|selected|current|on)(\s|$)/i.test(el.className || ""),
        selector: sel
      };
    }).filter((x) => x.text.length > 1);
    return {
      ok: true,
      href: location.href,
      isChatPage: /\/chat/i.test(location.pathname),
      count: items.length,
      selector: sel,
      keys: items.map((x) => x.key),
      items,
      active: getActiveConversationIdentity(),
      contentVersion: BHT_CONTENT_VERSION
    };
  }

  function collectEditorDiagnostic() {
    const mapEl = (el) => {
      let rect = { width: 0, height: 0 };
      try { const r = el.getBoundingClientRect(); rect = { width: Math.round(r.width), height: Math.round(r.height) }; } catch (_) {}
      return {
        tag: el.tagName,
        className: String(el.className || "").slice(0, 120),
        id: el.id || "",
        role: el.getAttribute?.("role") || "",
        placeholder:
          el.getAttribute?.("data-placeholder") ||
          el.getAttribute?.("placeholder") ||
          el.getAttribute?.("aria-label") ||
          "",
        rect
      };
    };
    return {
      href: location.href,
      title: document.title,
      activeConversation: getActiveConversationIdentity(),
      contenteditables: Array.from(document.querySelectorAll("[contenteditable='true']")).slice(0, 20).map(mapEl),
      textareas: Array.from(document.querySelectorAll("textarea, input")).slice(0, 20).map((el) => ({
        tag: el.tagName,
        type: el.type || "",
        className: String(el.className || "").slice(0, 80),
        id: el.id || "",
        placeholder: el.placeholder || ""
      })),
      iframes: Array.from(document.querySelectorAll("iframe")).slice(0, 10).map((el) => ({
        src: (el.src || "").slice(0, 160),
        title: el.title || "",
        className: String(el.className || "").slice(0, 80)
      })),
      hasUsable: hasUsableChatInput(),
      contentVersion: BHT_CONTENT_VERSION
    };
  }

  function resolveConversationElement(pick) {
    if (!pick) return null;
    const { nodes } = queryConversationRows();
    // 只用同一套 nodes，禁止 index 跨集合
    let el = nodes.find((n) => conversationKeyFromEl(n) === pick.key);
    if (!el && pick.text) {
      el = nodes.find((n) => textOf(n).includes(String(pick.text).slice(0, 12)));
    }
    if (!el && Number.isInteger(pick.index) && nodes[pick.index]) {
      // 仅当 key 也大致吻合时才用 index
      const cand = nodes[pick.index];
      if (!pick.key || conversationKeyFromEl(cand) === pick.key || textOf(cand).includes(String(pick.text || "").slice(0, 8))) {
        el = cand;
      }
    }
    return el || null;
  }

  async function waitAndOpenConversation(payload = {}) {
    // 阶段一：找到并确认打开目标会话（输入框失败不算“未找到会话”）
    const job = payload.job || {};
    const beforeKeys = new Set(payload.beforeKeys || []);
    const wantTitle = normalizeText(job.title || "");
    const wantCompany = normalizeText(job.company || "");
    const deadline = Date.now() + (payload.timeoutMs || 22000);
    const hardAmbiguousAfter = Date.now() + Math.min(12000, Math.max(5000, (payload.timeoutMs || 22000) - 4000));

    let lastSnap = null;
    let lastAmbiguous = null;
    let ambiguousRounds = 0;
    let lastSnapshotSignature = "";
    const attemptedKeys = new Set();

    debugTrace("conversation_wait_begin", {
      target: {
        title: job.title || "",
        company: job.company || "",
        hrName: job.hrName || job.bossName || ""
      },
      beforeKeyCount: beforeKeys.size,
      timeoutMs: payload.timeoutMs || 22000
    });

    while (Date.now() < deadline) {
      dismissCommonDialogs();
      lastSnap = getConversationSnapshot();
      const items = lastSnap.items || [];
      const snapshotSignature = items.slice(0, 8).map((item) => item.key + ":" + item.text).join("|");
      if (snapshotSignature !== lastSnapshotSignature) {
        lastSnapshotSignature = snapshotSignature;
        debugTrace("conversation_snapshot", {
          count: items.length,
          selector: lastSnap.selector,
          active: lastSnap.active,
          topRows: items.slice(0, 8).map((item) => ({
            index: item.index,
            key: item.key,
            text: item.text,
            hrName: item.hrName,
            company: item.company,
            title: item.title,
            isNew: Boolean(item.key && !beforeKeys.has(item.key)),
            active: item.active
          }))
        });
      }

      // 0) BOSS 已自动打开会话：头部身份匹配 + 输入框可用 → 直接成功
      try {
        const activeNow = getActiveConversationIdentity();
        const headOk = conversationHeaderMatches(job);
        const inputReady = hasUsableChatInput();
        if (headOk && inputReady) {
          // 公司必须至少弱命中，避免停在无关会话
          const headN = normalizeText(activeNow.head || activeNow.text || "");
          const companyOk = !wantCompany || headN.includes(wantCompany.slice(0, Math.min(3, wantCompany.length)));
          if (companyOk) {
            debugTrace("conversation_already_active", { active: activeNow, headOk, inputReady, companyOk });
            return {
              ok: true,
              matchedVia: "already-active-header",
              conversationText: String(activeNow.text || activeNow.head || "").slice(0, 120),
              active: activeNow,
              head: activeNow.head,
              contentVersion: BHT_CONTENT_VERSION
            };
          }
        }
      } catch (_) {}

      const selection = ConversationMatch?.selectConversationCandidate
        ? ConversationMatch.selectConversationCandidate(items, job, beforeKeys, { preferNewest: true })
        : { ok: false, error: "CONVERSATION_NOT_FOUND", top: [] };

      debugTrace("conversation_selection", {
        ok: selection.ok,
        error: selection.error || "",
        via: selection.via || "",
        score: selection.score || 0,
        reason: selection.ok
          ? "候选满足新会话与公司/HR/岗位身份规则"
          : selection.error === "CONVERSATION_AMBIGUOUS"
            ? "多个候选分数接近；仅凭置顶位置可能误发，等待列表稳定"
            : "当前列表没有达到安全阈值的候选",
        top: (selection.top || []).slice(0, 5).map((entry) => ({
          index: entry.item?.index,
          key: entry.item?.key,
          text: entry.item?.text,
          score: entry.score,
          isNew: entry.isNew,
          companyHit: entry.companyHit,
          hrHit: entry.hrHit,
          titleHit: entry.titleHit,
          companyScore: entry.companyScore,
          hrScore: entry.hrScore,
          titleScore: entry.titleScore
        }))
      }, selection.ok ? "debug" : "warn");

      // 歧义：不要立刻失败。刚点「立即沟通」时列表可能短暂出现多个同公司会话，
      // 新会话置顶/标题刷新需要几百毫秒～数秒。
      if (!selection.ok && selection.error === "CONVERSATION_AMBIGUOUS") {
        lastAmbiguous = selection;
        ambiguousRounds += 1;
        // 只等待列表稳定，不按“置顶/最新”猜测；歧义必须暂停，避免发错人。
        if (Date.now() < hardAmbiguousAfter) {
          await sleep(450);
          continue;
        }
        return {
          ok: false,
          error: "CONVERSATION_AMBIGUOUS",
          message: "消息列表中匹配到多个相似会话，已暂停避免发错人",
          top: (selection.top || []).slice(0, 3).map((entry) => ({
            score: entry.score,
            titleScore: entry.titleScore,
            companyScore: entry.companyScore,
            text: entry.item?.text || ""
          })),
          rounds: ambiguousRounds,
          contentVersion: BHT_CONTENT_VERSION
        };
        debugTrace("trigger_chat_button_not_found", missingButton, "error");
        return missingButton;
      }

      const pick = selection.ok ? selection.item : null;
      const via = selection.ok ? selection.via : "";

      if (pick) {
        if (attemptedKeys.has(pick.key)) {
          debugTrace("conversation_candidate_already_clicked", {
            key: pick.key,
            text: pick.text,
            reason: "本轮已点击过该候选，不重复点击，避免聊天界面闪烁"
          }, "warn");
          await sleep(400);
          continue;
        }
        const before = getActiveConversationIdentity();
        log("msg open candidate", { via, key: pick.key, text: pick.text, beforeKey: before.key });
        const row = resolveConversationElement(pick);
        if (!row) {
          debugTrace("conversation_candidate_dom_missing", { key: pick.key, text: pick.text }, "warn");
          // DOM 抖动：再等一轮
          await sleep(350);
          continue;
        }
        const clickable =
          row.querySelector("a[href], [role='button'], .friend-content, .user-item, .friend-item, .conversation-item, .geek-info-card") ||
          row;
        attemptedKeys.add(pick.key);
        debugTrace("conversation_candidate_click", {
          via,
          key: pick.key,
          index: pick.index,
          text: pick.text,
          before
        });
        try { clickable.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
        clickLikeHuman(clickable);
        await sleep(500);

        // 等待会话切换确认（多种信号，避免“点了但 active class 不变”）
        let switched = false;
        let after = before;
        let switchVia = "";
        for (let i = 0; i < 20; i++) {
          await sleep(300);
          after = getActiveConversationIdentity();
          const keyChanged = after.key && before.key && after.key !== before.key;
          const keyIsPick = after.key && pick.key && (after.key === pick.key || after.key.includes(String(pick.key).slice(0, 12)));
          const headOk = conversationHeaderMatches(job);
          const textOnHead = pick.text && normalizeText(after.head || "").includes(normalizeText(pick.text).slice(0, 6));
          const rowActive = ConversationMatch?.hasActiveState
            ? ConversationMatch.hasActiveState(row.className || "", row.getAttribute?.("aria-selected"))
            : /(^|\s)(active|selected|current|on)(\s|$)/i.test(row.className || "");
          const inputReady = hasUsableChatInput();

          if (i === 0 || i === 3 || i === 8 || i === 14 || headOk || keyIsPick) {
            debugTrace("conversation_switch_probe", {
              probe: i,
              keyChanged,
              keyIsPick,
              headOk,
              textOnHead,
              rowActive,
              inputReady,
              before,
              after
            });
          }

          if (keyChanged && (keyIsPick || headOk)) { switched = true; switchVia = "key-changed+identity"; break; }
          if (keyIsPick) { switched = true; switchVia = "key-is-pick"; break; }
          if (headOk) { switched = true; switchVia = "header-match"; break; }
          if (rowActive && (headOk || textOnHead || inputReady)) { switched = true; switchVia = "row-active"; break; }
          if (inputReady && (headOk || textOnHead || (wantCompany && normalizeText(after.head + pick.text).includes(wantCompany.slice(0, 3))))) {
            switched = true; switchVia = "input+context"; break;
          }

        }

        if (!switched) {
          const pickN = normalizeText(pick.text || "");
          const weakOk =
            hasUsableChatInput() &&
            wantCompany && pickN.includes(wantCompany.slice(0, 3)) &&
            (!wantTitle || pickN.includes(wantTitle.slice(0, 4)));
          if (weakOk) {
            switched = true;
            switchVia = "weak-pick-text+input";
            log("msg open weak accept", { pick: pick.text, head: getActiveConversationIdentity().head });
          }
        }

        if (!switched) {
          debugTrace("conversation_switch_unconfirmed", {
            key: pick.key,
            text: pick.text,
            active: getActiveConversationIdentity(),
            reason: "点击后没有足够的 active/header/input 身份信号；不再重复点击同一行"
          }, "warn");
          // 打开未确认：继续外层循环重试匹配，不要立刻整任务失败
          await sleep(400);
          continue;
        }

        // 身份必须来自已打开的头部或真正处于 active 状态的候选行
        const activeNow = getActiveConversationIdentity();
        const headN = normalizeText(activeNow.head || "");
        const pickN = normalizeText(pick.text || "");
        const activeIsPick = Boolean(
          activeNow.key &&
          pick.key &&
          (activeNow.key === pick.key || activeNow.key.includes(String(pick.key).slice(0, 12)))
        );
        const contextN = normalizeText([headN, activeIsPick ? pickN : "", activeIsPick ? activeNow.text : ""].join(" "));
        let idOk = true;
        if (!contextN) idOk = false;
        if (wantCompany && !contextN.includes(wantCompany.slice(0, 3))) idOk = false;
        if (wantTitle && contextN && !contextN.includes(wantTitle.slice(0, 4)) && !pickN.includes(wantTitle.slice(0, 4))) {
          // 岗位名在列表预览里常被截断，仅公司命中也可
          if (!(wantCompany && contextN.includes(wantCompany.slice(0, 3)))) idOk = false;
        }
        if (!idOk) {
          // 身份不匹配：继续找，不立刻 fail 整任务
          log("msg identity mismatch, retry", { head: activeNow.head, pick: pick.text, via, switchVia });
          debugTrace("conversation_identity_mismatch", {
            active: activeNow,
            pick: { key: pick.key, text: pick.text },
            target: { title: job.title || "", company: job.company || "", hrName: job.hrName || job.bossName || "" },
            via,
            switchVia
          }, "warn");
          await sleep(350);
          continue;
        }

        const opened = {
          ok: true,
          matchedVia: String(via || "") + "|" + switchVia,
          conversationText: String(pick.text || activeNow.text || "").slice(0, 120),
          active: activeNow,
          head: activeNow.head,
          pick,
          contentVersion: BHT_CONTENT_VERSION
        };
        debugTrace("conversation_open_confirmed", opened);
        return opened;
      }

      // 未命中：继续等新会话出现
      await sleep(400);
    }

    if (lastAmbiguous) {
      debugTrace("conversation_wait_ambiguous_timeout", {
        rounds: ambiguousRounds,
        top: (lastAmbiguous.top || []).slice(0, 5)
      }, "error");
      return {
        ok: false,
        error: "CONVERSATION_AMBIGUOUS",
        message: "消息列表中匹配到多个相似会话，已暂停避免发错人",
        top: (lastAmbiguous.top || []).slice(0, 3).map((entry) => ({
          score: entry.score,
          titleScore: entry.titleScore,
          companyScore: entry.companyScore,
          text: entry.item?.text || ""
        })),
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    const notFound = {
      ok: false,
      error: "CONVERSATION_NOT_FOUND",
      message: "未在消息列表中找到与该岗位匹配的会话",
      count: lastSnap?.count || 0,
      sample: (lastSnap?.items || []).slice(0, 5).map((x) => x.text),
      contentVersion: BHT_CONTENT_VERSION
    };
    debugTrace("conversation_wait_not_found", notFound, "error");
    return notFound;
  }

  async function waitChatEditor(payload = {}) {
    const timeoutMs = payload.timeoutMs || 30000;
    const start = Date.now();
    let lastDiagnostic = null;
    while (Date.now() - start < timeoutMs) {
      dismissCommonDialogs();
      if (hasUsableChatInput()) {
        return {
          ok: true,
          inputFound: true,
          diagnostic: collectEditorDiagnostic(),
          contentVersion: BHT_CONTENT_VERSION
        };
      }
      lastDiagnostic = collectEditorDiagnostic();
      // 尝试聚焦聊天主区域
      try {
        const root = getChatRoot();
        root?.click?.();
      } catch (_) {}
      await sleep(320);
    }
    return {
      ok: false,
      error: "CHAT_EDITOR_NOT_READY",
      message: "会话已打开，但未识别到消息输入框",
      diagnostic: lastDiagnostic,
      contentVersion: BHT_CONTENT_VERSION
    };
  }

async function runOpByType(type, payload = {}) {
    const lockKey = String(type || '');
    const needLock = /START_CHAT|INSPECT_JOB_DETAIL|ENRICH_JOB_ACTIVITY|TRIGGER_CONVERSATION|WAIT_OPEN_CONVERSATION|WAIT_CHAT_EDITOR|SEND_TEXT|SEND_IMAGE|SCAN_JOBS/.test(lockKey);
    if (needLock) {
      if (window.__BHT_OP_LOCK__) {
        return { ok: false, error: 'OP_BUSY', message: '已有操作进行中', contentVersion: BHT_CONTENT_VERSION };
      }
      window.__BHT_OP_LOCK__ = lockKey;
    }
    try {
    switch (type) {
      case MSG.PING:
        return {
          ok: true,
          page: pageInfo(),
          contentVersion: BHT_CONTENT_VERSION,
          contentInstanceId: BHT_CONTENT_INSTANCE_ID
        };
      case MSG.DIAGNOSE:
        return { ok: true, ...diagnose(), contentVersion: BHT_CONTENT_VERSION };
      case MSG.SCAN_JOBS:
        return await scanJobs(payload || {});
      case MSG.INSPECT_JOB_DETAIL:
        return isListLikePage()
          ? await inspectListSideDetail(payload?.job || {})
          : await inspectWorkerJobDetail(payload?.job || {});
      case MSG.ENRICH_JOB_ACTIVITY:
        return await enrichJobActivities(payload || {});
      case MSG.TRIGGER_CONVERSATION:
        return payload?.workerDetail
          ? await triggerConversationOnWorkerDetail(payload.job || {})
          : await triggerConversationOnList((payload && payload.job) || payload || {});
      case MSG.GET_CONVERSATION_SNAPSHOT:
        return getConversationSnapshot();
      case MSG.WAIT_OPEN_CONVERSATION:
        return await waitAndOpenConversation(payload || {});
      case MSG.WAIT_CHAT_EDITOR:
        return await waitChatEditor(payload || {});
      case MSG.START_CHAT:
        return await startChat(payload?.job || payload, payload || {});
      case MSG.GET_CHAT_SELF_MESSAGES:
        await waitForChat(8000);
        return { ok: true, messages: getSelfMessages(payload?.limit || 8) };
      case MSG.GET_BOSS_GREETING:
        return await getBossGreetingSetting();
      case MSG.SET_BOSS_GREETING:
        return await setBossGreetingSetting(payload || {});
      case MSG.SAVE_BOSS_GREETING_TEXT:
        return await saveBossGreetingText(payload || {});
      case MSG.SEND_TEXT:
        return await sendText(payload?.text || "", payload || {});
      case MSG.SEND_IMAGE:
        return await sendImageFromDataUrl(payload?.dataUrl, payload?.fileName);
      case MSG.HIGHLIGHT_JOBS:
        return highlightJobs(payload?.map || {});
      case MSG.CLOSE_CHAT:
        return await closeChatPanel();
      case MSG.ENSURE_JOB_LIST:
        return await ensureJobList(payload || {});
      case MSG.RETURN_TO_LIST:
        return await returnToJobList(payload || {});
      case MSG.SCROLL_LIST_TOP:
        return scrollListToTop();
      default:
        return { ok: false, error: "UNKNOWN_TYPE", type };
    }
    } finally {
      if (needLock && window.__BHT_OP_LOCK__ === lockKey) {
        window.__BHT_OP_LOCK__ = null;
        window.__BHT_OP_LOCK_AT__ = 0;
      }
    }
  }

  const onBhtMessage = (message, _sender, sendResponse) => {
    const { type, payload } = message || {};

    if (type === MSG.CANCEL_OP) {
      const opId = String(payload?.opId || "");
      debugTrace("operation_cancel_received", { opId, reason: payload?.reason || "任务已停止" }, "warn");
      if (!opId) {
        sendResponse({ ok: true, cancelled: false, opId: "" });
        return true;
      }
      window.__BHT_OP_CANCELLED__[opId] = true;
      if (opId && window.__BHT_OP_INFLIGHT__?.[opId]) {
        window.__BHT_OP_INFLIGHT__[opId].cancelled = true;
      }
      markOperationCancelled(opId, payload?.reason || "任务已停止", false);
      sendResponse({ ok: true, cancelled: Boolean(opId), opId });
      return true;
    }

    // storage 桥：立即 ACK，后台轮询结果，避免 SPA 点击打断 channel
    if (type === MSG.RUN_OP) {
      const opId = payload?.opId;
      const opType = payload?.opType || payload?.type;
      const opPayload = payload?.opPayload || payload?.payload || {};
      window.__BHT_DEBUG_ENABLED__ = opPayload?.__bhtDebugEnabled === true;
      debugTrace("operation_received", {
        opId,
        opType,
        page: { title: document.title, readyState: document.readyState }
      });
      const inflight = (window.__BHT_OP_INFLIGHT__ = window.__BHT_OP_INFLIGHT__ || Object.create(null));

      // 同 opId 幂等：已在执行则只 ACK，不二次 run（避免 OP_BUSY 覆盖真结果）
      if (opId && inflight[opId]) {
        try {
          sendResponse({ ok: true, accepted: true, deduped: true, opId, contentVersion: BHT_CONTENT_VERSION });
        } catch (_) {}
        return true;
      }

      try {
        sendResponse({ ok: true, accepted: true, opId, contentVersion: BHT_CONTENT_VERSION });
      } catch (_) {}

      (async () => {
        if (opId) inflight[opId] = { opType, opPayload, at: Date.now() };

        const isOperationCancelled = () => Boolean(opId && window.__BHT_OP_CANCELLED__?.[opId]);
        const markSettledCancellation = async (reason = "任务已停止") => {
          if (opId) await markOperationCancelled(opId, reason, true);
          if (opId) delete inflight[opId];
        };

        // Background owns the pending row. Content must never rewrite it:
        // doing so could overwrite a cancellation tombstone that arrived
        // between two async bootstrap steps. Yield once for a queued CANCEL_OP,
        // then re-check memory and storage immediately before dispatch.
        const dispatchGate = globalThis.BHTOperationDispatchGate?.awaitOperationDispatchPermit;
        if (typeof dispatchGate !== "function") {
          await markSettledCancellation("页面操作取消门禁未加载，请刷新 BOSS 页面后重试");
          return;
        }
        const permit = await dispatchGate({
          isCancelled: isOperationCancelled,
          readOperationState: async () => {
            if (!opId) return null;
            const bag = await chrome.storage.local.get("bht_op_" + opId);
            return bag && bag["bht_op_" + opId];
          },
          settleCancellation: async (reason) => {
            if (opId) window.__BHT_OP_CANCELLED__[opId] = true;
            await markSettledCancellation(reason);
          },
          finishCompleted: async (row) => {
            log("RUN_OP skip already done", opId, row?.result?.error || row?.result?.ok);
            if (opId) delete inflight[opId];
          }
        });
        if (!permit.ok) return;

        // 后台统一计算页面操作预算；页面只执行该预算，不再维护另一套冲突的固定超时。
        const requestedOperationTimeoutMs = Number(opPayload?.__bhtOperationTimeoutMs || 0);
        const opTimeoutMs = Number.isFinite(requestedOperationTimeoutMs) && requestedOperationTimeoutMs > 0
          ? Math.max(1000, requestedOperationTimeoutMs)
          : 15000;

        let result;
        let timedOut = false;
        let workPromise;
        try {
          window.__BHT_ACTIVE_OP_ID__ = opId || null;
          window.__BHT_ACTIVE_OP_TYPE__ = opType || null;
          debugTrace("operation_dispatch_begin", {
            opId,
            opType,
            timeoutMs: opTimeoutMs,
            payloadKeys: Object.keys(opPayload || {}).filter((key) => !key.startsWith("__bht"))
          });
          workPromise = (async () => {
            const opResult = await runOpByType(opType, opPayload);
            if (opResult === undefined) {
              const undefinedResult = {
                ok: false,
                error: "OP_RETURN_UNDEFINED",
                message: "页面操作函数结束但没有返回结果",
                opType,
                contentVersion: BHT_CONTENT_VERSION
              };
              debugTrace("operation_return_undefined", undefinedResult, "error");
              return undefinedResult;
            }
            if (opResult?.scanMeta && typeof opResult.scanMeta === "object") {
              opResult.scanMeta = { ...opResult.scanMeta, workCompletedAt: Date.now() };
            }
            debugTrace("operation_dispatch_return", { opId, opType, result: summarizeOperationResult(opResult) }, opResult?.ok ? "debug" : "warn");
            return opResult;
          })();
          let innerTimeoutId = null;
          const innerTimeoutPromise = new Promise((resolve) => {
            innerTimeoutId = setTimeout(() => {
              timedOut = true;
              if (opId) window.__BHT_OP_CANCELLED__[opId] = true;
              if (opId) window.__BHT_OP_TIMED_OUT__[opId] = true;
              debugTrace("operation_inner_timeout", { opId, opType, timeoutMs: opTimeoutMs }, "error");
              resolve({
                ok: false,
                error: "OP_DEADLINE_EXCEEDED",
                message: "页面操作超过统一时间预算，已终止",
                contentVersion: BHT_CONTENT_VERSION
              });
            }, opTimeoutMs);
          });
          try {
            result = await Promise.race([
              workPromise.then((r) => r),
              innerTimeoutPromise
            ]);
          } finally {
            if (innerTimeoutId != null) clearTimeout(innerTimeoutId);
          }
          // 超时后通知所有可取消等待尽快收尾，只给锁释放留短暂宽限。
          if (timedOut && workPromise) {
            log("RUN_OP deadline exceeded, cancelling work", opId, opType);
            try {
              const late = await Promise.race([
                workPromise.then((value) => ({ value })).catch((error) => ({ error })),
                new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 2500))
              ]);
              const lateResult = late?.value;
              if (
                opType === MSG.SCAN_JOBS &&
                lateResult &&
                Array.isArray(lateResult.jobs) &&
                lateResult.jobs.length
              ) {
                result = lateResult;
              }
            } catch (e) {
              debugTrace("operation_late_settle_error", { opId, opType, error: serializeDebugError(e) }, "error");
            }
          }
        } catch (err) {
          debugTrace("operation_dispatch_exception", { opId, opType, error: serializeDebugError(err) }, "error");
          result = {
            ok: false,
            error: err?.code === "OP_CANCELLED" ? "OP_CANCELLED" : String(err?.message || err),
            message: String(err?.message || err),
            contentVersion: BHT_CONTENT_VERSION
          };
        } finally {
          if (window.__BHT_ACTIVE_OP_ID__ === opId) window.__BHT_ACTIVE_OP_ID__ = null;
          if (window.__BHT_ACTIVE_OP_TYPE__ === opType) window.__BHT_ACTIVE_OP_TYPE__ = null;
        }
        if (!result) {
          result = { ok: false, error: "EMPTY_RESULT", contentVersion: BHT_CONTENT_VERSION };
        }

        // 禁止用 OP_BUSY 覆盖已成功/已完成结果
        try {
          if (opId) {
            const bag = await chrome.storage.local.get("bht_op_" + opId);
            const row = bag && bag["bht_op_" + opId];
            if (row && row.status === "done" && row.result && row.result.ok && !result.ok) {
              log("RUN_OP skip overwrite success with fail", opId, result.error);
              delete inflight[opId];
              return;
            }
            if (result.error === "OP_BUSY") {
              log("RUN_OP ignore OP_BUSY write", opId);
              delete inflight[opId];
              return;
            }
          }
        } catch (_) {}

        const wasCancelled = Boolean(!timedOut && opId && isOperationCancelled());
        if (wasCancelled) {
          result = { ok: false, error: "OP_CANCELLED", message: "任务已停止，页面操作已取消", contentVersion: BHT_CONTENT_VERSION };
        }
        try {
          if (wasCancelled) {
            await markOperationCancelled(opId, result.message || "任务已停止，页面操作已取消", true);
          } else {
            await chrome.storage.local.set({
              ["bht_op_" + opId]: {
                status: "done",
                opType,
                result,
                at: Date.now(),
                contentVersion: BHT_CONTENT_VERSION
              }
            });
          }
        } catch (e) {
          log("storage write fail", e);
        }
        debugTrace("operation_completed", {
          opId,
          opType,
          timedOut,
          wasCancelled,
          result: summarizeOperationResult(result)
        }, result?.ok ? "debug" : "warn");
        try {
          chrome.runtime.sendMessage({ type: "BHT_OP_DONE", payload: { opId, result: summarizeOperationResult(result) } }).catch(() => {});
        } catch (_) {}
        if (opId) delete inflight[opId];
        if (opId) {
          if (timedOut || window.__BHT_OP_TIMED_OUT__?.[opId]) {
            // 原操作可能还在收尾；保留取消墓碑，避免迟到的 sleep/DOM 步骤重新继续。
            setTimeout(() => {
              delete window.__BHT_OP_CANCELLED__[opId];
              delete window.__BHT_OP_TIMED_OUT__[opId];
            }, 60000);
          } else {
            delete window.__BHT_OP_CANCELLED__[opId];
          }
        }
      })();
      return true;
    }


    (async () => {
      try {
        return await runOpByType(type, payload || {});
      } catch (err) {
        log("handler error", err);
        debugTrace("direct_handler_exception", { type, error: serializeDebugError(err) }, "error");
        return { ok: false, error: String(err?.message || err), diagnostic: { error: serializeDebugError(err) } };
      }
    })().then((res) => {
      try { sendResponse(res); } catch (_) {}
    });
    return true;
  };
  if (window.__BHT_ON_MESSAGE__ && window.__BHT_ON_MESSAGE__ !== onBhtMessage) {
    try { chrome.runtime.onMessage.removeListener(window.__BHT_ON_MESSAGE__); } catch (_) {}
  }
  window.__BHT_ON_MESSAGE__ = onBhtMessage;
  chrome.runtime.onMessage.addListener(onBhtMessage);

  // pagehide flush: 尽量把进行中的 op 标记完成，避免后台永久 pending
  window.addEventListener("pagehide", () => {
    debugTrace("pagehide_pending_operations", {
      inflight: Object.keys(window.__BHT_OP_INFLIGHT__ || {}),
      reason: "页面导航会中断本页操作；后台将等待新页面并恢复可安全重试的扫描"
    }, "warn");
    try {
      const updates = {};
      for (const [opId, inflight] of Object.entries(window.__BHT_OP_INFLIGHT__ || {})) {
        // Do not turn a cancelled/timed-out operation into a synthetic
        // navigation success. The background owns the cancellation tombstone
        // and will either observe the settled marker or expire it safely.
        if (window.__BHT_OP_CANCELLED__?.[opId] || window.__BHT_OP_TIMED_OUT__?.[opId] || inflight?.cancelled) {
          updates["bht_op_" + opId] = {
            status: "cancelled",
            opId,
            reason: "任务已停止，页面操作已取消",
            at: Date.now(),
            settled: true,
            contentVersion: BHT_CONTENT_VERSION
          };
          continue;
        }
        const recoveredTrigger = buildTriggerNavigationRecovery(inflight);
        updates["bht_op_" + opId] = {
          status: "done",
          opType: inflight?.opType || "",
          result: recoveredTrigger || {
              ok: false,
              error: "NAVIGATED",
              message: "页面跳转，操作中断",
              contentVersion: BHT_CONTENT_VERSION
            },
          at: Date.now()
        };
        if (recoveredTrigger) {
          debugTrace("trigger_navigation_recovered", {
            opId,
            opType: inflight?.opType || "",
            result: recoveredTrigger
          }, "info");
        }
      }
      if (Object.keys(updates).length) chrome.storage.local.set(updates);
    } catch (_) {}
  });

  log("content script ready v" + BHT_CONTENT_VERSION, location.href, "cards=", getJobCards().length);
})();
