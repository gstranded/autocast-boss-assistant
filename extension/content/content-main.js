(() => {
  const MSG = {
    PING: "BHT_PING",
    GET_PAGE_INFO: "BHT_GET_PAGE_INFO",
    SCAN_JOBS: "BHT_SCAN_JOBS",
    START_CHAT: "BHT_START_CHAT",
    GET_CHAT_SELF_MESSAGES: "BHT_GET_CHAT_SELF_MESSAGES",
    SEND_TEXT: "BHT_SEND_TEXT",
    SEND_IMAGE: "BHT_SEND_IMAGE",
    HIGHLIGHT_JOBS: "BHT_HIGHLIGHT_JOBS",
    ENSURE_JOB_LIST: "BHT_ENSURE_JOB_LIST",
    RETURN_TO_LIST: "BHT_RETURN_TO_LIST",
    CLOSE_CHAT: "BHT_CLOSE_CHAT",
    DIAGNOSE: "BHT_DIAGNOSE",
    RUN_OP: "BHT_RUN_OP"
  };

  const BHT_CONTENT_VERSION = "1.2.9";
  // 版本化热更新：扩展重载后可重新注入，不卡在旧脚本
  if (window.__BHT_CONTENT_VERSION__ === BHT_CONTENT_VERSION && window.__BHT_ON_MESSAGE__) {
    return;
  }
  if (window.__BHT_ON_MESSAGE__) {
    try { chrome.runtime.onMessage.removeListener(window.__BHT_ON_MESSAGE__); } catch (_) {}
  }
  window.__BHT_CONTENT_VERSION__ = BHT_CONTENT_VERSION;
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
      "div[contenteditable='true'][data-placeholder]",
      "div[contenteditable='true']",
      "textarea.input-area",
      "textarea[placeholder*='聊']",
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
        if (/job_detail|geek\/job|\/job\//i.test(href)) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        }
      } catch (_) {}
    };
    document.addEventListener("click", blocker, true);
    const timer = setTimeout(() => {
      try { document.removeEventListener("click", blocker, true); } catch (_) {}
    }, ms);
    return () => {
      clearTimeout(timer);
      try { document.removeEventListener("click", blocker, true); } catch (_) {}
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

    const href = linkEl?.href || linkEl?.getAttribute?.("href") || "";
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
    const salary = textOf(salaryEl);
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
    return {
      href: location.href,
      title: document.title,
      ready: document.readyState,
      cardCount: cards.length,
      isBoss: /zhipin\.com|bosszhipin\.com/i.test(location.hostname),
      hasDetail: Boolean(firstEl(SELECTORS.detailRoot)),
      hasChatBtn: Boolean(firstEl(SELECTORS.chatOnDetail)),
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
    if (payload.scroll) await autoScrollList(payload.maxRounds || 6);
    const cards = getJobCards();
    const jobs = cards.map((c, i) => parseJobCard(c, i));
    return {
      ok: true,
      page: pageInfo(),
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
    return firstEl(SELECTORS.chatRoot);
  }

  function getChatInput() {
    return firstEl(SELECTORS.chatInput);
  }

  async function waitForChat(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (getChatRoot() || getChatInput()) return true;
      // 常见弹窗
      const confirmBtn = Array.from(document.querySelectorAll("button,a,.btn")).find((el) =>
        /确定|继续|我知道了|开启|同意|稍后|允许/.test(textOf(el))
      );
      if (confirmBtn) clickLikeHuman(confirmBtn);
      await sleep(280);
    }
    return false;
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
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
    const markers = [
      "登录立即与BOSS沟通",
      "APP扫码登录",
      "登录/注册",
      "短信验证码",
      "发送验证码",
      "微信登录/注册",
      "扫码登录",
      "请先登录",
      "手机号登录"
    ];
    const hit = markers.some((m) => bodyText.includes(m));
    // dialog-ish containers
    const dialog = Array.from(document.querySelectorAll("div,section,form")).find((el) => {
      const t = textOf(el);
      if (!t || t.length > 800) return false;
      return /登录\/注册|APP扫码登录|登录立即与BOSS沟通|短信验证码/.test(t);
    });
    if (hit || dialog) {
      return {
        ok: true,
        message: "检测到登录弹窗，请先登录 BOSS 直聘后再使用海投功能"
      };
    }
    // buttons
    const loginBtn = Array.from(document.querySelectorAll("button,a,div")).find((el) => {
      const t = textOf(el);
      return t === "登录/注册" || t === "登录" || t === "APP扫码登录";
    });
    if (loginBtn && /登录/.test(bodyText.slice(0, 2000))) {
      return {
        ok: true,
        message: "检测到未登录状态，请先登录 BOSS 直聘后再投递"
      };
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
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = input.getBoundingClientRect();
    return rect.width > 20 && rect.height > 10;
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

  async function ensureJobList({ maxWaitMs = 12000, scroll = true } = {}) {
    const readyCount = () => getJobCards().length;
    if (readyCount() > 0) {
      return { ok: true, count: readyCount(), restored: false, href: location.href };
    }

    // 聊天页先返回
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
      // 点「职位/推荐」导航
      const jobNav = Array.from(document.querySelectorAll("a,button,span,div")).find((el) => {
        const t = textOf(el);
        return t === "职位" || t === "推荐" || t === "首页" || /职位列表|找工作|职位推荐/.test(t);
      });
      if (jobNav) clickLikeHuman(jobNav);

      // 仍无卡片且路径不像列表，尝试进入 jobs（只跳一次，然后继续等）
      if (!navTried && readyCount() === 0 && /zhipin\.com|bosszhipin\.com/i.test(location.hostname)) {
        const path = location.pathname || "";
        const looksList = /geek\/(jobs|job)|rec-job|recommend|search|job_detail/i.test(path + location.href);
        if (!looksList) {
          navTried = true;
          const target = location.origin + "/web/geek/jobs";
          if (!location.href.startsWith(target)) {
            /* avoid navigate in msg handler */
            // 给 SPA 时间加载，不立刻判失败
            await sleep(1500);
          }
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

  async function returnToJobList() {
    await closeChatPanel();
    if (isChatPage() || (hasUsableChatInput() && getJobCards().length === 0)) {
      try { history.back(); } catch (_) {}
      await sleep(900);
    }
    try { await closeChatPanel(); } catch (_) {}
    let ensured = await ensureJobList({ maxWaitMs: 10000, scroll: true });
    if (!ensured.ok && getJobCards().length === 0) {
      const jobNav = Array.from(document.querySelectorAll("a,button,span,div")).find((el) => {
        const t = textOf(el);
        return t === "职位" || t === "推荐" || t === "首页";
      });
      if (jobNav) {
        clickLikeHuman(jobNav);
        await sleep(1000);
      }
      ensured = await ensureJobList({ maxWaitMs: 6000, scroll: true });
    }
    return ensured;
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
    // 若已在详情/聊天页，直接点沟通（用于导航后恢复）
    if (firstEl(SELECTORS.detailRoot) || firstEl(SELECTORS.chatOnDetail) || hasUsableChatInput()) {
      if (getJobCards().length < 3) {
        return await startChatOnCurrentDetail((opts && opts.job) || job || {});
      }
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

    let picked = tryPickVisible(true) || tryPickVisible(false);

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

  async function sendText(text) {
    if (!text || !String(text).trim()) return { ok: false, error: "EMPTY_TEXT" };
    dismissCommonDialogs();
    let ready = await waitForChat(14000);
    if (!ready) {
      // 再试一次：有时点完立即沟通后输入框延迟出现
      dismissCommonDialogs();
      await sleep(500);
      ready = await waitForChat(8000);
    }
    if (!ready) return { ok: false, error: "CHAT_TIMEOUT", message: "聊天输入框未就绪" };
    const input = getChatInput();
    if (!input || !hasUsableChatInput()) {
      return { ok: false, error: "INPUT_NOT_FOUND", message: "未找到可用聊天输入框" };
    }

    const before = getSelfMessages(8);
    await setInputText(input, text);
    await sleep(250);

    const written = (input.value || input.textContent || input.innerText || "").replace(/\s+/g, "");
    const needleFull = String(text).replace(/\s+/g, "");
    if (written.length < Math.min(4, needleFull.length)) {
      await setInputText(input, text);
      await sleep(200);
    }

    const sendBtn = findSendButton();
    if (sendBtn) clickLikeHuman(sendBtn);

    try { input.focus(); } catch (_) {}
    const fireKey = (opts) => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts }));
      input.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, ...opts }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...opts }));
    };
    fireKey({ key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    await sleep(120);
    fireKey({ key: "Enter", code: "Enter", keyCode: 13, which: 13, ctrlKey: true });

    const needle = needleFull.slice(0, 18);
    let confirmed = false;
    let selfTail = [];
    for (let i = 0; i < 16; i++) {
      await sleep(280);
      if (typeof detectLoginModal === "function") {
        const loginHit = detectLoginModal();
        if (loginHit.ok) return { ok: false, error: "LOGIN_REQUIRED", message: loginHit.message };
      }
      selfTail = getSelfMessages(10);
      confirmed = selfTail.some((m) => {
        const n = String(m).replace(/\s+/g, "");
        return n.includes(needle) || (needle.length > 8 && needle.includes(n.slice(0, 10)));
      });
      if (!confirmed && selfTail.length > before.length) {
        confirmed = Boolean(selfTail[selfTail.length - 1]);
      }
      if (!confirmed) {
        const nowVal = (input.value || input.textContent || input.innerText || "").replace(/\s+/g, "");
        if (nowVal.length === 0 && i >= 3) confirmed = true;
      }
      if (confirmed) break;
      if (i === 5 || i === 10) {
        const btn2 = findSendButton();
        if (btn2) clickLikeHuman(btn2);
      }
    }

    if (!confirmed) {
      return {
        ok: false,
        error: "SEND_NOT_CONFIRMED",
        message: "未检测到消息发送成功。请确认聊天框可输入，或手动发送后点重试",
        selfTail
      };
    }
    return { ok: true, confirmed: true, selfTail: selfTail.slice(-3) };
  }

  async function sendImageFromDataUrl(dataUrl, fileName = "resume.png") {
    const moreBtn = Array.from(document.querySelectorAll("button,a,div,i,span")).find((el) =>
      /图片|相册|附件|文件/.test(textOf(el))
    );
    if (moreBtn) clickLikeHuman(moreBtn);
    await sleep(350);

    const input = firstEl([
      "input[type='file'][accept*='image']",
      "input[type='file']"
    ]);
    if (!input) {
      return {
        ok: false,
        error: "FILE_INPUT_NOT_FOUND",
        message: "未找到上传控件。页面结构可能变化，请手动发送。"
      };
    }

    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], fileName, { type: blob.type || "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(900);
    const sendBtn = findSendButton();
    if (sendBtn) clickLikeHuman(sendBtn);
    return { ok: true };
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

  const onBhtMessage = (message, _sender, sendResponse) => {
    const { type, payload } = message || {};
    (async () => {
      try {
        switch (type) {
          case MSG.PING:
            return { ok: true, page: pageInfo() };
          case MSG.GET_PAGE_INFO:
            return { ok: true, page: pageInfo() };
          case MSG.DIAGNOSE:
            return { ok: true, ...diagnose() };
          case MSG.SCAN_JOBS:
            return await scanJobs(payload || {});
          case MSG.START_CHAT:
            return await startChat(payload?.job || payload, payload || {});
          case MSG.GET_CHAT_SELF_MESSAGES:
            await waitForChat(8000);
            return { ok: true, messages: getSelfMessages(payload?.limit || 8) };
          case MSG.SEND_TEXT:
            return await sendText(payload?.text || "");
          case MSG.SEND_IMAGE:
            return await sendImageFromDataUrl(payload?.dataUrl, payload?.fileName);
          case MSG.HIGHLIGHT_JOBS:
            return highlightJobs(payload?.map || {});
          case MSG.CLOSE_CHAT:
            return await closeChatPanel();
          case MSG.ENSURE_JOB_LIST:
            return await ensureJobList(payload || {});
          case MSG.RETURN_TO_LIST:
            return await returnToJobList();
          default:
            return { ok: false, error: "UNKNOWN_TYPE", type };
        }
      } catch (err) {
        log("handler error", err);
        return { ok: false, error: String(err?.message || err) };
      }
    })().then(sendResponse);
    return true;
  };
  window.__BHT_ON_MESSAGE__ = onBhtMessage;
  chrome.runtime.onMessage.addListener(onBhtMessage);

  // 长耗时操作走 Port，避免 tabs.sendMessage 被 SPA 点击打断
  if (!window.__BHT_ON_CONNECT__) {
    const onConnect = (port) => {
      if (!port || port.name !== "bht-op") return;
      port.onMessage.addListener((message) => {
        const { type, payload, reqId } = message || {};
        const run = async () => {
          try {
            return await runOpByType(type, payload || {});
          } catch (err) {
            return { ok: false, error: String(err?.message || err) };
          }
        };
        run().then((result) => {
          try { port.postMessage({ reqId, result }); } catch (_) {}
        });
      });
    };
    window.__BHT_ON_CONNECT__ = onConnect;
    chrome.runtime.onConnect.addListener(onConnect);
  }


  log("content script ready v" + BHT_CONTENT_VERSION, location.href, "cards=", getJobCards().length);
})();