(() => {
  const MSG = {
    PING: "BHT_PING",
    GET_PAGE_INFO: "BHT_GET_PAGE_INFO",
    SCAN_JOBS: "BHT_SCAN_JOBS",
    START_CHAT: "BHT_START_CHAT",
    GET_CURRENT_JOB_DETAIL: "BHT_GET_CURRENT_JOB_DETAIL",
    GET_CHAT_SELF_MESSAGES: "BHT_GET_CHAT_SELF_MESSAGES",
    SEND_TEXT: "BHT_SEND_TEXT",
    SEND_IMAGE: "BHT_SEND_IMAGE",
    SEND_RESUME: "BHT_SEND_RESUME",
    HIGHLIGHT_JOBS: "BHT_HIGHLIGHT_JOBS",
    ENSURE_JOB_LIST: "BHT_ENSURE_JOB_LIST",
    RETURN_TO_LIST: "BHT_RETURN_TO_LIST",
    CLOSE_CHAT: "BHT_CLOSE_CHAT",
    DIAGNOSE: "BHT_DIAGNOSE",
    RUN_OP: "BHT_RUN_OP"
  };

  const BHT_CONTENT_VERSION = "1.6.6";
  // 版本化热更新：扩展重载后可重新注入，不卡在旧脚本
  if (window.__BHT_CONTENT_VERSION__ === BHT_CONTENT_VERSION && window.__BHT_ON_MESSAGE__) {
    return;
  }
  if (window.__BHT_ON_MESSAGE__) {
    try { chrome.runtime.onMessage.removeListener(window.__BHT_ON_MESSAGE__); } catch (_) {}
  }
  window.__BHT_CONTENT_VERSION__ = BHT_CONTENT_VERSION;
  window.__BHT_OP_LOCK__ = null; // boot: 导航后新脚本不继承旧锁
  window.__BHT_CONTENT_LOADED__ = true;

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

  
  function isListLikePage(href = location.href) {
    try {
      const u = String(href || "");
      return /\/web\/geek\/jobs|recommend|search|rec-job|job-recommend|geek\/job(?!_detail)/i.test(u);
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
      if (forceHref || (cards >= 3 && /jobs|recommend|search|geek\/job/i.test(href))) {
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
    company: [".company-name", ".company-info .name", ".company-text", ".boss-name"],
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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
    const target = renderGlyphMatrix(ch, font);
    if (!target) return null;
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
        const ref = renderGlyphMatrix(String(d), f);
        if (!ref) continue;
        const sc = matrixScore(target, ref);
        if (sc < bestScore) {
          bestScore = sc;
          best = String(d);
        }
      }
    }
    // threshold: 24x32=768 cells; good matches usually << 220
    if (best != null && bestScore < 260) return best;
    return null;
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
    if (/[0-9]/.test(decoded)) return decoded;
    return s.replace(/[\uE000-\uF8FF]/g, "?");
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
    if (!el) return false;
    try {
      el.scrollIntoView({ block: "center", behavior: "instant" });
    } catch (_) {}
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new MouseEvent("mouseover", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    } catch (_) {
      try {
        el.click();
      } catch (_) {}
    }
    return true;
  }

  function normalizeText(input = "") {
    return String(input || "")
      .replace(/【[^】]*】/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\s+/g, "")
      .replace(/[【】\[\]()（）·•|｜]/g, "")
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
    const titleEl = firstEl(SELECTORS.title, card);
    const salaryEl = firstEl(SELECTORS.salary, card);
    const companyEl = firstEl(SELECTORS.company, card);
    const locationEl = firstEl(SELECTORS.location, card);
    const activeEl = firstEl(SELECTORS.activeText, card);
    const tags = allEl(SELECTORS.tags, card).map(textOf).filter(Boolean).slice(0, 12);

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
      extractJobIdFromHref(href);

    // securityId 可能在详情 more link，卡片阶段先空
    let securityId = extractSecurityId(href);

    const bossId =
      card.getAttribute?.("data-uid") ||
      card.getAttribute?.("data-bossid") ||
      card.getAttribute?.("data-boss-id") ||
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
    const company = textOf(companyEl);
    const salary = extractSalary(card, salaryEl);
    const location = textOf(locationEl);
    const activeText = textOf(activeEl) || (firstEl(SELECTORS.online, card) ? "在线" : "");
    const jd = [textOf(card), tags.join(" ")].join(" ");

    if (!jobId) {
      const stable = hashStr(normalizeText(title) + "|" + normalizeText(company));
      jobId = (title || company) ? ("name_" + stable) : ("dom_" + index + "_" + stable);
    }

    return {
      index,
      jobId,
      securityId,
      bossId,
      title,
      company,
      salary,
      location,
      activeText,
      tags,
      jd,
      href: href.startsWith("http") ? href : href ? new URL(href, location.origin).href : "",
      communicated,
      hasChat: communicated,
      canCommunicate: true,
      buttonText: btnText,
      hrName: "",
      online: Boolean(firstEl(SELECTORS.online, card))
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

  function pageInfo() {
    const cards = getJobCards();
    const hasChat = typeof hasUsableChatInput === "function" ? hasUsableChatInput() : Boolean(getChatInput());
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
      path: location.pathname
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
    if (payload.scroll) await autoScrollList(payload.maxRounds || 6);
    const cards = getJobCards();
    const jobs = cards.map((c, i) => parseJobCard(c, i));
    try{rememberListHref();}catch(_){} return { ok: true, listHref: (typeof getSavedListHref==="function"?getSavedListHref():"")||location.href, listExpectLabel: (typeof detectSelectedJobExpect==="function"?detectSelectedJobExpect():"")||"", listFilterHints: (typeof detectActiveFilterHints==="function"?detectActiveFilterHints():[]), page: pageInfo(),
      jobs,
      count: jobs.length,
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

  

  async function openJobDetail(job) {
    await ensureJobList({ maxWaitMs: 5000, scroll: true });
    let card = findCardByJob(job);
    if (!card && job?.title) {
      card = getJobCards().find((c, i) => {
        const p = parseJobCard(c, i);
        return p.title && (p.title === job.title || p.title.includes(job.title) || job.title.includes(p.title));
      }) || null;
    }
    if (!card) return { ok: false, error: "JOB_CARD_NOT_FOUND", message: "未找到岗位卡片" };

    const wrap = card.closest(".job-card-wrap") || card;
    try {
      wrap.scrollIntoView({ block: "center", behavior: "instant" });
    } catch (_) {}

    // 阻止标题链接整页跳转，只激活右侧详情
    preventLinkNavigation(wrap, 800);
    clickLikeHuman(wrap);
    await sleep(500);

    // 详情未出现再点一次卡片主体（仍阻止 a 跳转）
    if (!firstEl(SELECTORS.detailRoot) && !firstEl(SELECTORS.chatOnDetail)) {
      preventLinkNavigation(wrap, 800);
      clickLikeHuman(card);
      await sleep(500);
    }

    const more = firstEl(SELECTORS.moreLink);
    const securityId = extractSecurityId(more?.href || "");
    const detailRoot = firstEl(SELECTORS.detailRoot) || document;
    const detailSalary = textOf(firstEl(SELECTORS.salary, detailRoot));
    return {
      ok: true,
      securityId,
      detailSalary,
      detailReady: Boolean(firstEl(SELECTORS.detailRoot) || firstEl(SELECTORS.chatOnDetail))
    };
  }

  async function clickChatButton() {
    let btn =
      firstEl(SELECTORS.chatOnDetail) ||
      Array.from(document.querySelectorAll("a.op-btn-chat, a.op-btn, button")).find((el) =>
        /立即沟通|继续沟通|打招呼/.test(textOf(el))
      );

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
    if (readyCount() > 0) {
      return { ok: true, count: readyCount(), restored: false, href: location.href };
    }

    // 聊天页先返回（软返回，不硬刷新）
    if (isChatPage()) {
      try { history.back(); } catch (_) {}
      await sleep(900);
    }
    await closeChatPanel();
    await sleep(300);

    if (scroll) {
      try { await autoScrollList(6); } catch (_) {}
    }

    const start = Date.now();
    let navTried = false;
    while (Date.now() - start < maxWaitMs) {
      if (readyCount() > 0) {
        return { ok: true, count: readyCount(), restored: true, href: location.href };
      }

      // 仅当当前明显不是职位列表页时，才尝试点顶部「职位」入口。
      // 禁止点「推荐/首页」：会把用户选好的求职期望与网页筛选冲掉。
      if (!noHomeNav && !isListLikePage() && !navTried) {
        const jobNav = Array.from(document.querySelectorAll("a,button,span,div")).find((el) => {
          const t = textOf(el);
          // 只允许精确「职位」或明确职位列表入口，避免点到推荐
          return t === "职位" || t === "职位列表" || t === "找工作";
        });
        if (jobNav) {
          navTried = true;
          clickLikeHuman(jobNav);
          await sleep(800);
        }
      }

      // 仍无卡片且不在列表：只等待 SPA，不 location 硬跳到裸 /web/geek/jobs
      if (!navTried && readyCount() === 0 && /zhipin\.com|bosszhipin\.com/i.test(location.hostname)) {
        if (!isListLikePage()) {
          navTried = true;
          await sleep(1500);
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
      message: count > 0 ? "" : "未找到职位列表卡片。请停留在 BOSS 职位推荐/搜索列表页后重试，或重新扫描预览"
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

    
  function getCurrentJobDetail() {
    const href = location.href;
    const isList = /\/web\/geek\/jobs|recommend|search/i.test(location.pathname + location.search);
    const isChat = /\/chat/i.test(location.pathname);
    const isJob = /job_detail|encryptJobId|\/geek\/job/i.test(location.href);
    const jobId = extractJobIdFromHref(href) || "";
    const detailRoot = firstEl(SELECTORS.detailRoot) || document;
    const title =
      textOf(firstEl(SELECTORS.title, detailRoot)) ||
      textOf(document.querySelector(".job-name, .job-title, h1")) ||
      "";
    const company =
      textOf(firstEl(SELECTORS.company, detailRoot)) ||
      textOf(document.querySelector(".company-name, .company-info .name")) ||
      "";
    const locationText =
      textOf(firstEl(SELECTORS.location, detailRoot)) ||
      textOf(document.querySelector(".job-location, .job-area, .company-location")) ||
      "";
    const salary =
      textOf(firstEl(SELECTORS.salary, detailRoot)) ||
      textOf(document.querySelector(".job-salary, .salary")) ||
      "";
    const jd =
      textOf(document.querySelector(".job-detail-section, .job-sec-text, .job-detail, .detail-content")) ||
      textOf(detailRoot).slice(0, 4000);
    let securityId = extractSecurityId(href);
    try {
      const more = firstEl(SELECTORS.moreLink, detailRoot);
      securityId = extractSecurityId(more?.href || "") || securityId;
    } catch (_) {}
    return {
      ok: true,
      job: {
        href,
        jobId,
        securityId: securityId || "",
        title,
        company,
        location: locationText,
        salary,
        jd,
        path: location.pathname,
        isListPage: /\/web\/geek\/jobs|recommend/i.test(location.pathname),
        isChatPage: /\/chat/i.test(location.pathname),
        isJobPage: /job_detail|encryptJobId|\/geek\/job/i.test(location.href)
      },
      page: pageInfo(),
      contentVersion: BHT_CONTENT_VERSION
    };
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

  function visibleActionElement(el) {
    if (!el || el.getAttribute?.("aria-hidden") === "true") return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8;
    } catch (_) {
      return true;
    }
  }

  function compactActionText(el) {
    return textOf(el).replace(/\s+/g, "");
  }

  function findPlatformResumeButton({ includeAlreadySent = true } = {}) {
    const chatRoot = getChatRoot() || document.getElementById("bht-mock-chat") || document;
    const roots = [chatRoot, chatRoot?.parentElement, document].filter(Boolean);
    const seen = new Set();
    const candidates = [];
    for (const root of roots) {
      try {
        for (const el of root.querySelectorAll("button, a, [role='button'], .btn, .chat-tool span, .chat-action span")) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (!visibleActionElement(el)) continue;
          candidates.push(el);
        }
      } catch (_) {}
    }
    const sentPattern = /^(已发简历|简历已发送|已发送简历)$/;
    if (includeAlreadySent) {
      const already = candidates.find((el) => sentPattern.test(compactActionText(el)));
      if (already) return { el: already, already: true };
    }
    const sendPattern = /^(发简历|发送简历|投递简历)$/;
    const button = candidates.find((el) =>
      sendPattern.test(compactActionText(el)) &&
      !el.disabled &&
      el.getAttribute?.("aria-disabled") !== "true"
    );
    return button ? { el: button, already: false } : null;
  }

  function findResumeConfirmButton() {
    const dialogs = Array.from(document.querySelectorAll(
      "[role='dialog'], .boss-dialog, .dialog-wrap, .dialog-container, .modal, .dialog"
    )).filter((el) => visibleActionElement(el) && /简历/.test(textOf(el)));
    for (const dialog of dialogs) {
      const buttons = Array.from(dialog.querySelectorAll("button, a, [role='button'], .btn"))
        .filter(visibleActionElement);
      const confirm = buttons.find((el) =>
        /^(发送|确定发送|确认发送|确认|确定)$/.test(compactActionText(el)) &&
        !/取消|关闭/.test(compactActionText(el))
      );
      if (confirm) return confirm;
    }
    return null;
  }

  function resumeSuccessTextVisible() {
    const selectors = [
      ".toast",
      ".toast-content",
      ".message-tip",
      ".alert",
      "[role='status']",
      "[role='dialog']",
      ".boss-dialog",
      ".dialog-wrap"
    ];
    try {
      return Array.from(document.querySelectorAll(selectors.join(",")))
        .filter(visibleActionElement)
        .slice(-20)
        .some((el) => {
          const text = compactActionText(el);
          return /简历.*(发送成功|已发送)|(发送成功|已发送).*简历/.test(text);
        });
    } catch (_) {
      return false;
    }
  }

  async function sendPlatformResume(context = {}) {
    dismissCommonDialogs();
    const ready = await waitForChat(10000);
    if (!ready) {
      return { ok: false, error: "CHAT_TIMEOUT", message: "聊天输入框未就绪，无法发送 BOSS 在线简历" };
    }

    const found = findPlatformResumeButton({ includeAlreadySent: true });
    if (!found) {
      return {
        ok: false,
        error: "RESUME_BUTTON_NOT_FOUND",
        message: "聊天页未找到「发简历」按钮",
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    const activeConversation = getActiveConversationIdentity();
    const makeReceipt = (confirmedVia, already = false) => {
      const sentAt = Date.now();
      return {
        type: "RESUME_SENT",
        status: "confirmed",
        receiptId: "resume_" + sentAt + "_" + Math.random().toString(36).slice(2, 10),
        jobId: context.jobId || "",
        conversationKey: context.conversationKey || activeConversation.key || "",
        confirmedVia,
        already,
        sentAt,
        contentVersion: BHT_CONTENT_VERSION
      };
    };

    if (found.already) {
      return {
        ok: true,
        confirmed: true,
        already: true,
        receipt: makeReceipt("button-already-sent", true),
        activeConversation,
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    const beforeMessages = getSelfMessages(30);
    clickLikeHuman(found.el);

    // 某些版本会弹出二次确认，只在“包含简历”的对话框内点击一次确认。
    for (let i = 0; i < 8; i++) {
      await sleep(200);
      const confirm = findResumeConfirmButton();
      if (confirm) {
        clickLikeHuman(confirm);
        break;
      }
    }

    let confirmedVia = "";
    let selfTail = beforeMessages;
    for (let i = 0; i < 28; i++) {
      await sleep(250);
      selfTail = getSelfMessages(30);
      const beforeSignature = beforeMessages.map((message) => String(message).replace(/\s+/g, "")).join("\n");
      const afterSignature = selfTail.map((message) => String(message).replace(/\s+/g, "")).join("\n");
      const resumeCardAdded =
        beforeSignature !== afterSignature &&
        selfTail.slice(-6).some((message) => /简历|在线简历|附件简历/.test(String(message)));
      if (resumeCardAdded) {
        confirmedVia = "self-message-resume-card";
        break;
      }
      if (resumeSuccessTextVisible()) {
        confirmedVia = "resume-success-status";
        break;
      }
      const afterButton = findPlatformResumeButton({ includeAlreadySent: true });
      if (afterButton?.already || (afterButton?.el && (afterButton.el.disabled || afterButton.el.getAttribute?.("aria-disabled") === "true"))) {
        confirmedVia = "resume-button-state";
        break;
      }
    }

    if (!confirmedVia) {
      return {
        ok: false,
        error: "RESUME_SEND_NOT_CONFIRMED",
        message: "已点击「发简历」，但页面没有返回可验证的发送成功状态",
        selfTail: selfTail.slice(-5),
        activeConversation,
        contentVersion: BHT_CONTENT_VERSION
      };
    }

    return {
      ok: true,
      confirmed: true,
      receipt: makeReceipt(confirmedVia),
      activeConversation,
      selfTail: selfTail.slice(-5),
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
    for (let i = 0; i < 24; i++) {
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
      const sendBtn = findSendButton();
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

  async function triggerConversationOnList(job = {}) {
    try { rememberListHref(); } catch (_) {}
    dismissCommonDialogs();
    if (typeof detectLoginModal === "function") {
      const loginHit = detectLoginModal();
      if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
    }

    await ensureJobList({ maxWaitMs: 8000, scroll: true, noHomeNav: true });
    let card = findCardByJob(job);
    if (!card) {
      try { card = await findCardByScrolling(job, 50); } catch (_) {}
    }
    if (!card) {
      const samples = getJobCards().slice(0, 5).map((el, i) => parseJobCard(el, i).title).filter(Boolean);
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

    const release = installJobNavGuard(12000);
    try {
      const wrap = card.closest?.(".job-card-wrap, li, .job-card-box") || card;
      try { wrap.scrollIntoView({ block: "center", behavior: "instant" }); } catch (_) {}
      await sleep(200);
      // 点卡片切换右侧详情（拦截整页跳转）
      preventLinkNavigation(wrap, 1500);
      clickLikeHuman(wrap);
      await sleep(700);

      // 再点一次标题区域提高详情刷新概率
      const titleEl = firstEl(SELECTORS.title, wrap) || wrap;
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
      if (!titleOk) {
        log("list detail title weak match", { want: job.title, got: detailTitle });
      }

      // 点立即沟通 / 继续沟通（详情区优先）
      let clicked = { ok: false };
      for (let i = 0; i < 14; i++) {
        const scope =
          firstEl(SELECTORS.detailRoot) ||
          document.querySelector(".job-detail, .job-detail-box, .job-detail-container") ||
          document;
        let btn =
          firstEl(SELECTORS.chatOnDetail, scope) ||
          Array.from(scope.querySelectorAll("a,button,div,span")).find((el) =>
            /立即沟通|继续沟通/.test(textOf(el))
          ) ||
          Array.from(document.querySelectorAll("a.op-btn-chat, a.op-btn, button, div[class*='btn']")).find((el) =>
            /立即沟通|继续沟通/.test(textOf(el))
          );
        if (btn) {
          const buttonText = textOf(btn);
          clickLikeHuman(btn);
          clicked = { ok: true, buttonText, already: /继续沟通/.test(buttonText) };
          break;
        }
        await sleep(280);
      }
      if (!clicked.ok) {
        if (typeof detectLoginModal === "function") {
          const loginHit = detectLoginModal();
          if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message, contentVersion: BHT_CONTENT_VERSION };
        }
        return {
          ok: false,
          error: "CHAT_BUTTON_NOT_FOUND",
          message: "列表详情区未找到「立即沟通」按钮",
          detailTitle,
          href: location.href,
          contentVersion: BHT_CONTENT_VERSION
        };
      }

      await sleep(450);
      let stay = clickStayOnListDialog();
      if (!stay.ok) {
        await sleep(500);
        stay = clickStayOnListDialog();
      }
      // 再关一次常见弹层
      dismissCommonDialogs();

      return {
        ok: true,
        phase: "CHAT_TRIGGERED",
        buttonText: clicked.buttonText,
        already: Boolean(clicked.already),
        stayed: Boolean(stay.ok),
        stayText: stay.text || "",
        detailTitle: detailTitle || "",
        listHref: location.href,
        contentVersion: BHT_CONTENT_VERSION
      };
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
    const head = normalizeText(getActiveConversationIdentity().head || "");
    if (!head) return false;
    const wantCompany = normalizeText(job.company || "");
    const wantTitle = normalizeText(job.title || "");
    const wantHr = normalizeText(job.hrName || job.bossName || "");
    let hits = 0;
    if (wantCompany && head.includes(wantCompany.slice(0, Math.min(3, wantCompany.length)))) hits += 1;
    if (wantTitle && head.includes(wantTitle.slice(0, Math.min(4, wantTitle.length)))) hits += 1;
    if (wantHr && head.includes(wantHr)) hits += 1;
    // 至少命中公司或岗位之一
    return hits >= 1;
  }

  function getConversationSnapshot() {
    const { sel, nodes } = queryConversationRows();
    const items = nodes.slice(0, 60).map((el, index) => {
      const text = textOf(el);
      const key = conversationKeyFromEl(el) || ("idx_" + index + "_" + text.slice(0, 24));
      return {
        index,
        key,
        text: text.slice(0, 120),
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
    // 阶段一：只负责找到并确认打开目标会话（不把输入框失败当成未找到会话）
    const job = payload.job || {};
    const beforeKeys = new Set(payload.beforeKeys || []);
    const wantTitle = normalizeText(job.title || "");
    const wantCompany = normalizeText(job.company || "");
    const wantHr = normalizeText(job.hrName || job.bossName || "");
    const deadline = Date.now() + (payload.timeoutMs || 18000);

    let lastSnap = null;
    while (Date.now() < deadline) {
      dismissCommonDialogs();
      lastSnap = getConversationSnapshot();
      const items = lastSnap.items || [];
      const selection = ConversationMatch?.selectConversationCandidate
        ? ConversationMatch.selectConversationCandidate(items, job, beforeKeys)
        : { ok: false, error: "CONVERSATION_NOT_FOUND", top: [] };
      if (!selection.ok && selection.error === "CONVERSATION_AMBIGUOUS") {
        return {
          ok: false,
          error: "CONVERSATION_AMBIGUOUS",
          message: "消息列表中匹配到多个相似会话，已暂停避免发错人",
          top: (selection.top || []).slice(0, 3).map((entry) => ({
            score: entry.score,
            text: entry.item?.text || ""
          })),
          contentVersion: BHT_CONTENT_VERSION
        };
      }
      const pick = selection.ok ? selection.item : null;
      const via = selection.ok ? selection.via : "";

      if (pick) {
        const before = getActiveConversationIdentity();
        log("msg open candidate", { via, key: pick.key, text: pick.text, beforeKey: before.key });
        const row = resolveConversationElement(pick);
        if (!row) {
          return {
            ok: false,
            error: "CONVERSATION_ELEMENT_NOT_FOUND",
            message: "匹配到会话但 DOM 节点已变化，无法点击",
            pick,
            contentVersion: BHT_CONTENT_VERSION
          };
        }
        const clickable =
          row.querySelector("a[href], [role='button'], .friend-content, .user-item, .friend-item, .conversation-item, .geek-info-card") ||
          row;
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
          // 列表项自身变 active
          const rowActive = ConversationMatch?.hasActiveState
            ? ConversationMatch.hasActiveState(row.className || "", row.getAttribute?.("aria-selected"))
            : /(^|\s)(active|selected|current|on)(\s|$)/i.test(row.className || "");
          // 输入框出现也算打开成功的强信号（但还要头部/公司校验）
          const inputReady = hasUsableChatInput();

          if (keyChanged && (keyIsPick || headOk)) { switched = true; switchVia = "key-changed+identity"; break; }
          if (keyIsPick) { switched = true; switchVia = "key-is-pick"; break; }
          if (headOk) { switched = true; switchVia = "header-match"; break; }
          if (rowActive && (headOk || textOnHead || inputReady)) { switched = true; switchVia = "row-active"; break; }
          if (inputReady && (headOk || textOnHead || (wantCompany && normalizeText(after.head + pick.text).includes(wantCompany.slice(0, 3))))) {
            switched = true; switchVia = "input+context"; break;
          }

          if (i === 3 || i === 8 || i === 14) {
            const a = row.querySelector("a[href], [role='button'], .friend-content, .user-item, .friend-item") || row;
            clickLikeHuman(a);
          }
        }

        if (!switched) {
          // 最后兜底：候选文本已含公司+岗位，且输入框可用，允许继续但记 weak
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
          return {
            ok: false,
            error: "CONVERSATION_OPEN_NOT_CONFIRMED",
            message: "已点击会话，但未确认切换成功",
            before,
            after: getActiveConversationIdentity(),
            pickText: pick.text,
            diagnostic: collectEditorDiagnostic(),
            contentVersion: BHT_CONTENT_VERSION
          };
        }

        // 身份必须来自已打开的头部或真正处于 active 状态的候选行，不能只凭“点过的文本”放行。
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
          return {
            ok: false,
            error: "CONVERSATION_IDENTITY_MISMATCH",
            message: "打开的会话与目标公司/岗位不匹配，已停止发送",
            head: activeNow.head,
            pickText: pick.text,
            wantCompany: job.company,
            wantTitle: job.title,
            contentVersion: BHT_CONTENT_VERSION
          };
        }

        return {
          ok: true,
          opened: true,
          matchedVia: via + "|" + switchVia,
          conversationText: pick.text,
          active: activeNow,
          contentVersion: BHT_CONTENT_VERSION
        };
      }
      await sleep(450);
    }

    return {
      ok: false,
      error: "CONVERSATION_NOT_FOUND",
      message: "消息页未找到对应会话。公司=" + (job.company || "") + " 岗位=" + (job.title || ""),
      snapshotCount: lastSnap?.count || 0,
      sample: (lastSnap?.items || []).slice(0, 5).map((x) => x.text),
      contentVersion: BHT_CONTENT_VERSION
    };
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
    const needLock = /START_CHAT|SEND_TEXT|SEND_IMAGE|SEND_RESUME|SCAN_JOBS/.test(lockKey) || /BHT_START_CHAT|BHT_SEND_TEXT|BHT_SEND_IMAGE|BHT_SEND_RESUME|BHT_SCAN_JOBS/.test(lockKey);
    if (needLock) {
      if (window.__BHT_OP_LOCK__) {
        return { ok: false, error: 'OP_BUSY', message: '已有操作进行中', contentVersion: BHT_CONTENT_VERSION };
      }
      window.__BHT_OP_LOCK__ = lockKey;
    }
    try {
    switch (type) {
      case MSG.PING:
      case "BHT_PING":
        return { ok: true, page: pageInfo(), contentVersion: BHT_CONTENT_VERSION };
      case MSG.GET_PAGE_INFO:
      case "BHT_GET_PAGE_INFO":
        return { ok: true, page: pageInfo(), contentVersion: BHT_CONTENT_VERSION };
      case MSG.DIAGNOSE:
      case "BHT_DIAGNOSE":
        return { ok: true, ...diagnose(), contentVersion: BHT_CONTENT_VERSION };
      case MSG.SCAN_JOBS:
      case "BHT_SCAN_JOBS":
        return await scanJobs(payload || {});
      case MSG.GET_CURRENT_JOB_DETAIL:
      case "BHT_GET_CURRENT_JOB_DETAIL":
        return getCurrentJobDetail();
      case "BHT_TRIGGER_CONVERSATION":
      case MSG.TRIGGER_CONVERSATION:
        return await triggerConversationOnList((payload && payload.job) || payload || {});
      case "BHT_GET_CONVERSATION_SNAPSHOT":
      case MSG.GET_CONVERSATION_SNAPSHOT:
        return getConversationSnapshot();
      case "BHT_WAIT_OPEN_CONVERSATION":
      case MSG.WAIT_OPEN_CONVERSATION:
        return await waitAndOpenConversation(payload || {});
      case "BHT_WAIT_CHAT_EDITOR":
      case MSG.WAIT_CHAT_EDITOR:
        return await waitChatEditor(payload || {});
      case MSG.START_CHAT:
      case "BHT_START_CHAT":
        return await startChat(payload?.job || payload, payload || {});
      case MSG.GET_CHAT_SELF_MESSAGES:
      case "BHT_GET_CHAT_SELF_MESSAGES":
        await waitForChat(8000);
        return { ok: true, messages: getSelfMessages(payload?.limit || 8) };
      case MSG.SEND_TEXT:
      case "BHT_SEND_TEXT":
        return await sendText(payload?.text || "", payload || {});
      case MSG.SEND_IMAGE:
      case "BHT_SEND_IMAGE":
        return await sendImageFromDataUrl(payload?.dataUrl, payload?.fileName);
      case MSG.SEND_RESUME:
      case "BHT_SEND_RESUME":
        return await sendPlatformResume(payload || {});
      case MSG.HIGHLIGHT_JOBS:
      case "BHT_HIGHLIGHT_JOBS":
        return highlightJobs(payload?.map || {});
      case MSG.CLOSE_CHAT:
      case "BHT_CLOSE_CHAT":
        return await closeChatPanel();
      case MSG.ENSURE_JOB_LIST:
      case "BHT_ENSURE_JOB_LIST":
        return await ensureJobList(payload || {});
      case MSG.RETURN_TO_LIST:
      case "BHT_RETURN_TO_LIST":
        return await returnToJobList(payload || {});
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

    // storage 桥：立即 ACK，后台轮询结果，避免 SPA 点击打断 channel
    if (type === "BHT_RUN_OP" || type === MSG.RUN_OP) {
      const opId = payload?.opId;
      const opType = payload?.opType || payload?.type;
      const opPayload = payload?.opPayload || payload?.payload || {};
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
        if (opId) inflight[opId] = { opType, at: Date.now() };

        // 若 storage 已是 done，不再重跑
        try {
          if (opId) {
            const bag = await chrome.storage.local.get("bht_op_" + opId);
            const row = bag && bag["bht_op_" + opId];
            if (row && row.status === "done") {
              log("RUN_OP skip already done", opId, row.result?.error || row.result?.ok);
              delete inflight[opId];
              return;
            }
          }
        } catch (_) {}

        try {
          await chrome.storage.local.set({
            ["bht_op_" + opId]: {
              status: "pending",
              opType,
              at: Date.now(),
              contentVersion: BHT_CONTENT_VERSION
            }
          });
        } catch (_) {}

        // START_CHAT 允许更长；超时不强制清锁抢跑，由 finally 统一释放
        const opTimeoutMs = /START_CHAT/.test(String(opType || ""))
          ? 45000
          : /SEND_TEXT|SEND_IMAGE|SEND_RESUME|SCAN_JOBS/.test(String(opType || ""))
            ? 30000
            : 15000;

        let result;
        let timedOut = false;
        let workPromise;
        try {
          workPromise = runOpByType(opType, opPayload);
          result = await Promise.race([
            workPromise.then((r) => r),
            sleep(opTimeoutMs).then(() => {
              timedOut = true;
              return {
                ok: false,
                error: "OP_INNER_TIMEOUT",
                message: "页面内操作超时",
                contentVersion: BHT_CONTENT_VERSION
              };
            })
          ]);
          // 超时后仍等原任务收尾（最多再 15s），避免锁被提前清掉后并发
          if (timedOut && workPromise) {
            log("RUN_OP timed out, waiting work settle", opId, opType);
            try {
              const late = await Promise.race([
                workPromise,
                sleep(15000).then(() => null)
              ]);
              if (late && late.ok) result = late;
            } catch (e) {
              if (!result) result = { ok: false, error: String(e?.message || e), contentVersion: BHT_CONTENT_VERSION };
            }
          }
        } catch (err) {
          result = { ok: false, error: String(err?.message || err), contentVersion: BHT_CONTENT_VERSION };
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

        try {
          await chrome.storage.local.set({
            ["bht_op_" + opId]: {
              status: "done",
              opType,
              result,
              at: Date.now(),
              contentVersion: BHT_CONTENT_VERSION
            }
          });
        } catch (e) {
          log("storage write fail", e);
        }
        try {
          chrome.runtime.sendMessage({ type: "BHT_OP_DONE", payload: { opId, result } }).catch(() => {});
        } catch (_) {}
        if (opId) delete inflight[opId];
      })();
      return true;
    }


    (async () => {
      try {
        return await runOpByType(type, payload || {});
      } catch (err) {
        log("handler error", err);
        return { ok: false, error: String(err?.message || err) };
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

  // Port 备用通道
  if (!window.__BHT_ON_CONNECT__) {
    const onConnect = (port) => {
      if (!port || port.name !== "bht-op") return;
      port.onMessage.addListener((message) => {
        const { type, payload, reqId } = message || {};
        (async () => {
          try {
            return await runOpByType(type, payload || {});
          } catch (err) {
            return { ok: false, error: String(err?.message || err) };
          }
        })().then((result) => {
          try { port.postMessage({ reqId, result }); } catch (_) {}
        });
      });
    };
    window.__BHT_ON_CONNECT__ = onConnect;
    chrome.runtime.onConnect.addListener(onConnect);
  }

  // 若上次 START_CHAT 因跳转被杀，聊天页加载后自动收尾
  // pagehide flush: 尽量把进行中的 op 标记完成，避免后台永久 pending
  window.addEventListener("pagehide", () => {
    try {
      // best-effort; may not complete if context dies instantly
      chrome.storage.local.get(null, (all) => {
        try {
          const entries = Object.entries(all || {}).filter(([k, v]) => k.startsWith("bht_op_") && v && v.status === "pending");
          for (const [k, v] of entries) {
            // 若当前已有可用聊天输入，START_CHAT 直接成功；其它写 NAVIGATED 让后台重试
            const isStart = !v.opType || /START_CHAT/i.test(String(v.opType));
            const okChat = typeof hasUsableChatInput === "function" && hasUsableChatInput();
            chrome.storage.local.set({
              [k]: {
                status: "done",
                opType: v.opType,
                result: isStart && okChat
                  ? { ok: true, already: true, matchedVia: "pagehide-chat", contentVersion: BHT_CONTENT_VERSION }
                  : { ok: false, error: "NAVIGATED", message: "页面跳转，操作中断", contentVersion: BHT_CONTENT_VERSION },
                at: Date.now()
              }
            });
          }
        } catch (_) {}
      });
    } catch (_) {}
  });

  (async function resumePendingOps() {
    try {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const all = await chrome.storage.local.get(null);
        const entries = Object.entries(all || {}).filter(([k, v]) => k.startsWith("bht_op_") && v && v.status === "pending");
        if (!entries.length) return;
        dismissCommonDialogs();
        if (!hasUsableChatInput()) {
          await sleep(400);
          continue;
        }
        for (const [k, v] of entries) {
          const opType = String(v?.opType || "");
          const isStart =
            !opType ||
            /START_CHAT/i.test(opType) ||
            opType === MSG.START_CHAT;
          // 仅收尾开聊；SEND_TEXT 等应在当前页由后台重新下发
          if (!isStart) continue;
          await chrome.storage.local.set({
            [k]: {
              status: "done",
              opType: opType || MSG.START_CHAT,
              result: {
                ok: true,
                already: true,
                job: {},
                contentVersion: BHT_CONTENT_VERSION,
                matchedVia: "pending-resume-chat"
              },
              at: Date.now()
            }
          });
          log("resumed pending START_CHAT on chat page", k);
        }
        return;
      }
    } catch (e) {
      log("resumePendingOps fail", e);
    }
  })();

  log("content script ready v" + BHT_CONTENT_VERSION, location.href, "cards=", getJobCards().length);
})();
