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
    if (job?.index != null && cards[job.index]) {
      const parsed = parseJobCard(cards[job.index], job.index);
      if (!job.jobId || parsed.jobId === job.jobId || parsed.title === job.title) {
        return cards[job.index];
      }
    }
    return (
      cards.find((c, i) => {
        const p = parseJobCard(c, i);
        if (job.jobId && p.jobId === job.jobId) return true;
        return p.title === job.title && p.company === job.company;
      }) || null
    );
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
    const card = findCardByJob(job);
    if (!card) return { ok: false, error: "JOB_CARD_NOT_FOUND" };

    // 优先点卡片本体或标题，激活右侧详情
    const titleLink = firstEl(SELECTORS.title, card);
    clickLikeHuman(card);
    if (titleLink) {
      await sleep(120);
      clickLikeHuman(titleLink);
    }
    await sleep(450);

    // 补充 securityId / 薪资从详情读取
    const more = firstEl(SELECTORS.moreLink);
    const securityId = extractSecurityId(more?.href || "");
    const detailSalary = textOf(firstEl(SELECTORS.salary, firstEl(SELECTORS.detailRoot) || document));
    return {
      ok: true,
      securityId,
      detailSalary,
      detailReady: Boolean(firstEl(SELECTORS.detailRoot))
    };
  }

  async function clickChatButton() {
    // 详情区沟通按钮
    let btn =
      firstEl(SELECTORS.chatOnDetail) ||
      Array.from(document.querySelectorAll("a,button")).find((el) =>
        /立即沟通|继续沟通|打招呼/.test(textOf(el))
      );

    if (!btn) return { ok: false, error: "CHAT_BUTTON_NOT_FOUND", buttonText: "" };

    const buttonText = textOf(btn);
    clickLikeHuman(btn);
    return { ok: true, buttonText, already: /继续沟通/.test(buttonText) };
  }

  async function startChat(job) {
    const opened = await openJobDetail(job);
    if (!opened.ok) return opened;

    // 若卡片本身有按钮也可点
    const card = findCardByJob(job);
    const cardBtn = card
      ? Array.from(card.querySelectorAll("a,button")).find((el) =>
          /立即沟通|继续沟通|打招呼/.test(textOf(el))
        )
      : null;
    if (cardBtn) {
      clickLikeHuman(cardBtn);
    } else {
      const clicked = await clickChatButton();
      if (!clicked.ok) return clicked;
    }

    const chatReady = await waitForChat(12000);
    if (!chatReady) {
      // 未登录时可能弹出登录框
      const login = Array.from(document.querySelectorAll("a,button,div")).find((el) =>
        /登录|注册|扫码登录/.test(textOf(el))
      );
      if (login) {
        return {
          ok: false,
          error: "LOGIN_REQUIRED",
          message: "检测到登录提示，请先登录 BOSS 直聘后再投递"
        };
      }
      return { ok: false, error: "CHAT_TIMEOUT", securityId: opened.securityId };
    }
    return {
      ok: true,
      already: false,
      securityId: opened.securityId,
      detailSalary: opened.detailSalary
    };
  }

  function getSelfMessages(limit = 8) {
    const root = getChatRoot() || document;
    let nodes = allEl(SELECTORS.selfMsg, root);
    let texts = nodes.map(textOf).filter(Boolean);
    if (!texts.length) {
      const bubbles = allEl(
        [".message-item .text", ".msg-content", ".message-content", ".text"],
        root
      );
      texts = bubbles.map(textOf).filter(Boolean).slice(-limit);
    }
    return texts.slice(-limit);
  }

  async function setInputText(input, text) {
    input.focus();
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
      const proto =
        input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      input.focus();
      try {
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, text);
      } catch (_) {
        input.textContent = text;
        input.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" })
        );
      }
    }
    await sleep(120);
  }

  function findSendButton() {
    return (
      Array.from(document.querySelectorAll("button,a,div[role='button']")).find((el) =>
        /^发送$|发送消息|^send$/i.test(textOf(el))
      ) || firstEl(SELECTORS.sendBtn)
    );
  }

  async function sendText(text) {
    const ready = await waitForChat(8000);
    if (!ready) return { ok: false, error: "CHAT_TIMEOUT" };
    const input = getChatInput();
    if (!input) return { ok: false, error: "INPUT_NOT_FOUND" };
    await setInputText(input, text);
    await sleep(160);
    const sendBtn = findSendButton();
    if (sendBtn) clickLikeHuman(sendBtn);
    else {
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
    await sleep(500);
    const self = getSelfMessages(5);
    const ok = self.some(
      (m) =>
        m.includes(text.slice(0, Math.min(12, text.length))) ||
        text.includes(m.slice(0, Math.min(12, m.length)))
    );
    return { ok: true, confirmed: ok, selfTail: self.slice(-3) };
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