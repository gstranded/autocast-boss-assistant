(() => {
  const BHT_FLOAT_HOST_VERSION = "1.3.2";
  if (window.__BHT_FLOAT_HOST_VERSION__ === BHT_FLOAT_HOST_VERSION && window.__BHT_FLOAT_HOST__) return;
  window.__BHT_FLOAT_HOST_VERSION__ = BHT_FLOAT_HOST_VERSION;
  window.__BHT_FLOAT_HOST__ = true;

  const ROOT_ID = "bht-float-root";
  const STORAGE_POS = "bht_float_pos_v1";
  const STORAGE_OPEN = "bht_float_open_v1";
  const STORAGE_FAB = "bht_float_fab_v1";

  function loadCss() {
    if (document.getElementById("bht-float-css")) return;
    const link = document.createElement("link");
    link.id = "bht-float-css";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content/floating-host.css");
    (document.head || document.documentElement).appendChild(link);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function getRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <button type="button" class="bht-fab" id="bht-fab" title="Boss 海投助手" aria-label="打开 Boss 海投助手">
        <img src="${chrome.runtime.getURL("assets/icons/icon128.png")}" alt="" />
      </button>
      <div class="bht-panel" id="bht-panel" hidden>
        <div class="bht-panel-header" id="bht-drag">
          <div class="bht-panel-title">
            <img src="${chrome.runtime.getURL("assets/icons/icon48.png")}" alt="" />
            <span>Boss 海投助手</span>
          </div>
          <div class="bht-panel-actions">
            <button type="button" class="bht-icon-btn" id="bht-min" title="收起">—</button>
            <button type="button" class="bht-icon-btn" id="bht-close" title="关闭">×</button>
          </div>
        </div>
        <iframe class="bht-frame" id="bht-frame" title="Boss 海投助手面板"></iframe>
      </div>
    `;
    document.documentElement.appendChild(root);
    return root;
  }

  function savePos(panel) {
    const rect = panel.getBoundingClientRect();
    const data = { left: rect.left, top: rect.top };
    try {
      localStorage.setItem(STORAGE_POS, JSON.stringify(data));
    } catch (_) {}
  }

  function restorePos(panel) {
    try {
      const raw = localStorage.getItem(STORAGE_POS);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (typeof pos.left === "number" && typeof pos.top === "number") {
        panel.style.left = clamp(pos.left, 8, window.innerWidth - 80) + "px";
        panel.style.top = clamp(pos.top, 8, window.innerHeight - 80) + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
    } catch (_) {}
  }

  function setOpen(open) {
    const panel = document.getElementById("bht-panel");
    const fab = document.getElementById("bht-fab");
    if (!panel || !fab) return;
    panel.hidden = !open;
    fab.classList.toggle("is-hidden", open);
    if (open) {
      const frame = document.getElementById("bht-frame");
      if (frame) {
        // FORCE_IFRAME_RELOAD: 每次打开都带版本号，避免浮窗卡在旧 UI
        const next = chrome.runtime.getURL("sidepanel/index.html?mode=float&v=1.3.2");
        if (!frame.src || !frame.src.includes("v=1.3.2")) {
          frame.src = next;
        }
      }
      restorePos(panel);
    }
    try {
      localStorage.setItem(STORAGE_OPEN, open ? "1" : "0");
    } catch (_) {}
  }

  function setFabVisible(visible) {
    const fab = document.getElementById("bht-fab");
    if (!fab) return;
    fab.style.display = visible ? "" : "none";
    try {
      localStorage.setItem(STORAGE_FAB, visible ? "1" : "0");
    } catch (_) {}
  }

  
  function enableFabDrag(fab) {
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, origL = 0, origT = 0;
    const STORE = "bht_fab_pos_v1";

    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const pos = JSON.parse(raw);
        if (typeof pos.left === "number" && typeof pos.top === "number") {
          fab.style.left = pos.left + "px";
          fab.style.top = pos.top + "px";
          fab.style.right = "auto";
          fab.style.bottom = "auto";
        }
      }
    } catch (_) {}

    const onDown = (e) => {
      dragging = true;
      moved = false;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;
      const rect = fab.getBoundingClientRect();
      origL = rect.left;
      origT = rect.top;
      fab.style.left = origL + "px";
      fab.style.top = origT + "px";
      fab.style.right = "auto";
      fab.style.bottom = "auto";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (e.cancelable && moved) e.preventDefault();
      const left = Math.max(0, Math.min(window.innerWidth - 48, origL + dx));
      const top = Math.max(0, Math.min(window.innerHeight - 48, origT + dy));
      fab.style.left = left + "px";
      fab.style.top = top + "px";
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      const rect = fab.getBoundingClientRect();
      try {
        localStorage.setItem(STORE, JSON.stringify({ left: rect.left, top: rect.top }));
      } catch (_) {}
      // 若发生拖动，阻止紧随其后的 click 打开面板
      if (moved) {
        fab.dataset.skipClick = "1";
        setTimeout(() => {
          delete fab.dataset.skipClick;
        }, 80);
      }
    };
    fab.addEventListener("mousedown", onDown);
    fab.addEventListener("touchstart", onDown, { passive: true });
  }

  function enableDrag(panel, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origL = 0;
    let origT = 0;

    const onDown = (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;
      const rect = panel.getBoundingClientRect();
      origL = rect.left;
      origT = rect.top;
      panel.style.left = origL + "px";
      panel.style.top = origT + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
    };

    const onMove = (e) => {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const left = clamp(origL + dx, 0, window.innerWidth - Math.min(w, 80));
      const top = clamp(origT + dy, 0, window.innerHeight - 48);
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      savePos(panel);
    };

    handle.addEventListener("mousedown", onDown);
    handle.addEventListener("touchstart", onDown, { passive: true });
  }

  function init() {
    loadCss();
    const root = getRoot();
    const fab = root.querySelector("#bht-fab");
    const panel = root.querySelector("#bht-panel");
    const drag = root.querySelector("#bht-drag");
    const btnMin = root.querySelector("#bht-min");
    const btnClose = root.querySelector("#bht-close");

    enableFabDrag(fab);
    fab.addEventListener("click", (e) => {
      if (fab.dataset.skipClick === "1") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      setOpen(true);
    });
    btnMin.addEventListener("click", () => setOpen(false));
    btnClose.addEventListener("click", () => setOpen(false));
    enableDrag(panel, drag);

    let fabVisible = true;
    try {
      fabVisible = localStorage.getItem(STORAGE_FAB) !== "0";
    } catch (_) {}
    setFabVisible(fabVisible);

    let shouldOpen = false;
    try {
      shouldOpen = localStorage.getItem(STORAGE_OPEN) === "1";
    } catch (_) {}
    if (shouldOpen) setOpen(true);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const type = msg?.type;
    if (type === "BHT_FLOAT_OPEN") {
      init();
      setFabVisible(true);
      setOpen(true);
      sendResponse({ ok: true });
      return true;
    }
    if (type === "BHT_FLOAT_CLOSE") {
      setOpen(false);
      sendResponse({ ok: true });
      return true;
    }
    if (type === "BHT_FLOAT_TOGGLE_FAB") {
      init();
      const fab = document.getElementById("bht-fab");
      const visible = fab && fab.style.display === "none" ? true : false;
      // if currently shown, hide; if hidden, show
      const nowHidden = fab?.style.display === "none";
      setFabVisible(nowHidden ? true : false);
      if (!nowHidden) setOpen(false);
      sendResponse({ ok: true, fabVisible: nowHidden });
      return true;
    }
    if (type === "BHT_FLOAT_PING") {
      sendResponse({ ok: true, ready: true });
      return true;
    }
    return false;
  });

  // auto mount FAB on BOSS pages
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();