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
    DIAGNOSE: "BHT_DIAGNOSE"
  };

  if (window.__BHT_CONTENT_LOADED__) return;
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
    company: [".boss-name", ".company-name", ".company-info .name", ".company-text"],
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

  function preventLinkNavigation(root, ms = 600) {
    const scope = root || document;
    const anchors = Array.from(scope.querySelectorAll("a[href]"));
    const onClick = (e) => {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch (_) {}
    };
    anchors.forEach((a) => a.addEventListener("click", onClick, true));
    setTimeout(() => {
      anchors.forEach((a) => a.removeEventListener("click", onClick, true));
    }, ms);
    return anchors.length;
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

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function extractJobIdFromHref(href = "") {
    if (!href) return "";
    const m1 = href.match(/job_detail\/([^~.?\s/]+)/i);
    if (m1) return decodeURIComponent(m1[1].replace(/\.html$/i, ""));
    const m2 = href.match(/[?&](?:jobId|jid)=([^&]+)/i);
    if (m2) return decodeURIComponent(m2[1]);
    return "";
  }

  function extractSecurityId(href = "") {
    const m = String(href).match(/[?&]securityId=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function getJobCards() {
    const cards = allEl(SELECTORS.card);
    // 去重：优先 li.job-card-box
    const uniq = [];
    const seen = new Set();
    for (const c of cards) {
      const key = c;
      if (seen.has(key)) continue;
      // 忽略过短节点
      if (textOf(c).length < 6) continue;
      seen.add(key);
      uniq.push(c);
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
      linkEl?.getAttribute?.("data-jobid") ||
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

    if (!jobId) jobId = `dom_${index}_${hashStr(title + company + salary + location)}`;

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
    if (!cards.length) return null;
    // 优先 jobId 精确匹配
    if (job?.jobId) {
      const byId = cards.find((c, i) => parseJobCard(c, i).jobId === job.jobId);
      if (byId) return byId;
    }
    // 标题+公司
    if (job?.title) {
      const byTitle = cards.find((c, i) => {
        const p = parseJobCard(c, i);
        if (p.title !== job.title) return false;
        if (job.company && p.company && p.company !== job.company) return false;
        return true;
      });
      if (byTitle) return byTitle;
    }
    // 最后才用 index，且二次校验标题
    if (job?.index != null && cards[job.index]) {
      const parsed = parseJobCard(cards[job.index], job.index);
      if (!job.title || parsed.title === job.title) return cards[job.index];
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
    const closeCandidates = Array.from(
      document.querySelectorAll(
        "button, a, i, span, div[class*='close'], .icon-close, .chat-close, [aria-label*='关闭']"
      )
    ).filter((el) => {
      const t = textOf(el);
      const aria = el.getAttribute?.("aria-label") || "";
      const cls = String(el.className || "");
      return (
        t === "关闭" ||
        t === "×" ||
        t === "x" ||
        /关闭/.test(aria) ||
        /close|icon-close|chat-close/i.test(cls)
      );
    });
    if (closeCandidates[0]) {
      clickLikeHuman(closeCandidates[0]);
      await sleep(350);
    }
    // ESC 关闭浮层
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    await sleep(200);
    return { ok: true };
  }

  async function returnToJobList() {
    await closeChatPanel();
    // 若在聊天页，返回列表
    if (isChatPage() || (hasUsableChatInput() && getJobCards().length === 0)) {
      try {
        history.back();
      } catch (_) {}
      await sleep(800);
    }
    const ensured = await ensureJobList({ maxWaitMs: 10000 });
    return ensured;
  }

  async function startChat(job) {
    // 尽量恢复列表，但不因列表检测失败直接放弃（卡片可能仍在）
    const ensured = await ensureJobList({ maxWaitMs: 8000, scroll: true });
    let card = findCardByJob(job);

    // 二次模糊匹配：标题包含关系
    if (!card && job?.title) {
      const cards = getJobCards();
      card = cards.find((c, i) => {
        const p = parseJobCard(c, i);
        return p.title && (p.title === job.title || p.title.includes(job.title) || job.title.includes(p.title));
      }) || null;
      if (card) {
        // 同步最新 jobId
        const parsed = parseJobCard(card, 0);
        if (parsed.jobId) job.jobId = parsed.jobId;
      }
    }

    if (!card) {
      return {
        ok: false,
        error: "JOB_CARD_NOT_FOUND",
        message: ensured?.ok
          ? "列表中找不到该岗位，请重新扫描预览后再投递"
          : (ensured?.message || "职位列表未就绪，请打开职位列表页并重新扫描预览"),
        listCount: getJobCards().length,
        href: location.href
      };
    }

    const opened = await openJobDetail(job);
    if (!opened.ok && opened.error !== "LIST_NOT_READY") {
      // openJobDetail 内部还会 ensure；若仅 list 警告但 card 在，继续
      if (opened.error === "JOB_CARD_NOT_FOUND") return opened;
    }

    // 详情区立即沟通
    let clicked = await clickChatButton();
    if (!clicked.ok) {
      const cardBtn = Array.from(card.querySelectorAll("a,button")).find((el) =>
        /立即沟通|继续沟通|打招呼/.test(textOf(el))
      );
      if (!cardBtn) {
        return {
          ok: false,
          error: "CHAT_BUTTON_NOT_FOUND",
          message: "未找到「立即沟通」按钮，请确认已登录且岗位可沟通"
        };
      }
      clickLikeHuman(cardBtn);
      clicked = { ok: true, buttonText: textOf(cardBtn), already: /继续沟通/.test(textOf(cardBtn)) };
    }

    await sleep(450);
    dismissCommonDialogs();
    {
      const loginHit = detectLoginModal();
      if (loginHit.ok) {
        return {
          ok: false,
          error: "LOGIN_REQUIRED",
          message: loginHit.message
        };
      }
    }
    const chatReady = await waitForChat(14000);
    if (!chatReady) {
      const loginHit = detectLoginModal();
      if (loginHit.ok) {
        return {
          ok: false,
          error: "LOGIN_REQUIRED",
          message: loginHit.message
        };
      }
      const login = Array.from(document.querySelectorAll("a,button,div")).find((el) =>
        /登录|注册|扫码登录/.test(textOf(el))
      );
      if (login) {
        return {
          ok: false,
          error: "LOGIN_REQUIRED",
          message: "检测到登录相关界面，请先登录 BOSS 直聘后再投递"
        };
      }
      return {
        ok: false,
        error: "CHAT_TIMEOUT",
        message: "聊天窗口未出现，请手动点一次「立即沟通」确认页面是否正常",
        securityId: opened?.securityId
      };
    }

    return {
      ok: true,
      already: Boolean(clicked.already),
      securityId: opened?.securityId,
      detailSalary: opened?.detailSalary,
      chatPage: isChatPage(),
      href: location.href
    };
  }

  async function setInputText(input, text) {
    input.focus();
    await sleep(80);
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // contenteditable / BOSS 自定义输入
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(input);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch (_) {}
      if (!inserted) {
        input.textContent = text;
        input.innerHTML = "";
        input.appendChild(document.createTextNode(text));
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(120);
  }

  function findSendButton() {
    const nodes = Array.from(document.querySelectorAll("button,a,div[role='button'],span"));
    // 避免点到「发送简历」等
    const exact = nodes.find((el) => {
      const t = textOf(el);
      return t === "发送" || t === "发送消息";
    });
    if (exact) return exact;
    return (
      nodes.find((el) => /^发送$|发送消息|^send$/i.test(textOf(el))) ||
      firstEl(SELECTORS.sendBtn)
    );
  }

  async function sendText(text) {
    if (!text || !String(text).trim()) return { ok: false, error: "EMPTY_TEXT" };
    const ready = await waitForChat(10000);
    if (!ready) return { ok: false, error: "CHAT_TIMEOUT" };
    const input = getChatInput();
    if (!input || !hasUsableChatInput()) return { ok: false, error: "INPUT_NOT_FOUND" };

    const before = getSelfMessages(6);
    await setInputText(input, text);
    await sleep(200);

    const sendBtn = findSendButton();
    if (sendBtn) {
      clickLikeHuman(sendBtn);
    } else {
      // Ctrl+Enter / Enter 兼容
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true
        })
      );
    }

    // 等待消息出现在自己侧
    const needle = String(text).replace(/\s+/g, "").slice(0, 16);
    let confirmed = false;
    let selfTail = [];
    for (let i = 0; i < 12; i++) {
      await sleep(300);
      selfTail = getSelfMessages(8);
      confirmed = selfTail.some((m) => {
        const n = String(m).replace(/\s+/g, "");
        return n.includes(needle) || needle.includes(n.slice(0, 12));
      });
      // 或数量增加
      if (!confirmed && selfTail.length > before.length) {
        // 宽松：最后一条非空
        confirmed = Boolean(selfTail[selfTail.length - 1]);
      }
      if (confirmed) break;
    }

    if (!confirmed) {
      return {
        ok: false,
        error: "SEND_NOT_CONFIRMED",
        message: "未检测到消息发送成功，请检查聊天输入框是否可用",
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
            return await startChat(payload?.job || payload);
          case MSG.GET_CHAT_SELF_MESSAGES:
            await waitForChat(5000);
            return { ok: true, messages: getSelfMessages(payload?.limit || 8) };
          case MSG.SEND_TEXT:
            return await sendText(payload?.text || "");
          case MSG.SEND_IMAGE:
            return await sendImageFromDataUrl(payload?.dataUrl, payload?.fileName);
          case MSG.HIGHLIGHT_JOBS:
            return highlightJobs(payload?.map || {});
          default:
            return { ok: false, error: "UNKNOWN_TYPE", type };
        }
      } catch (err) {
        log("handler error", err);
        return { ok: false, error: String(err?.message || err) };
      }
    })().then(sendResponse);
    return true;
  });

  log("content script ready", location.href, "cards=", getJobCards().length);
})();