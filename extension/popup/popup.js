import { isBossUrl } from "../shared/boss-url.js";

const app = document.getElementById("app");

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function renderGuide(version) {
  app.innerHTML = `
    <div class="brand blue">Boss 海投助手</div>
    <div class="title">请前往 BOSS 直聘页面使用插件</div>
    <div class="guide">
      <h3>使用说明</h3>
      <ol>
        <li>打开 <b>BOSS 直聘</b> 职位推荐/搜索列表页</li>
        <li>点击扩展图标，或点击页面右下角悬浮球打开面板</li>
        <li>配置筛选、消息模板与简历方案</li>
        <li>先点「扫描预览」，核对将投递岗位</li>
        <li>确认后开始投递，可随时暂停/停止</li>
      </ol>
    </div>
    <div class="actions">
      <button class="btn primary" id="openBoss">打开 BOSS 直聘</button>
    </div>
    <div class="hint">仅在 zhipin.com / bosszhipin.com 生效</div>
    <div class="footer">
      <span>v${version}</span>
      <a href="https://github.com/gstranded/boss-haitou-assistant" target="_blank" rel="noreferrer">说明</a>
    </div>
  `;
  document.getElementById("openBoss").addEventListener("click", async () => {
    await chrome.tabs.create({ url: "https://www.zhipin.com/web/geek/jobs" });
    window.close();
  });
}

function renderBossReady(tab, version) {
  app.innerHTML = `
    <div class="brand blue">Boss 海投助手</div>
    <div class="status"><span class="dot"></span>已连接到 BOSS 页面，可打开悬浮面板</div>
    <div class="actions">
      <button class="btn primary" id="openPanel">打开悬浮面板</button>
      <button class="btn ghost" id="toggleFab">显示/隐藏悬浮球</button>
    </div>
    <div class="hint">面板可拖动；不用时可收起成右下角小图标</div>
    <div class="footer">
      <span>v${version}</span>
      <span title="${tab.url || ""}">当前为 BOSS 页</span>
    </div>
  `;
  document.getElementById("openPanel").addEventListener("click", async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "BHT_FLOAT_OPEN" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/floating-host.js"]
      });
      await chrome.tabs.sendMessage(tab.id, { type: "BHT_FLOAT_OPEN" });
    }
    window.close();
  });
  document.getElementById("toggleFab").addEventListener("click", async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "BHT_FLOAT_TOGGLE_FAB" });
    } catch (_) {}
    window.close();
  });
}

const manifest = chrome.runtime.getManifest();
const version = manifest.version || "1.0.0";
const tab = await getActiveTab();
if (tab && isBossUrl(tab.url || "")) renderBossReady(tab, version);
else renderGuide(version);