import { isBossUrl } from "../shared/boss-url.js";
import { STORAGE_KEYS } from "../shared/constants.js";

const app = document.getElementById("app");

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function renderGuide(version) {
  app.innerHTML = `
    <div class="hero">
      <img class="logo" src="../assets/icons/icon128.png" alt="logo" />
      <div class="brand">Boss 海投助手</div>
    </div>
    <div class="title">请前往 BOSS 直聘页面使用插件</div>
    <div class="guide">
      <div class="guide-title">使用说明</div>
      <ol>
        <li>打开 <b>BOSS 直聘</b> 职位推荐/搜索列表页</li>
        <li>打开插件后，点击页面右下角 <b>悬浮球</b></li>
        <li>配置筛选、打招呼消息与简历方案</li>
        <li>先点「扫描预览」，核对通过/跳过原因</li>
        <li>确认投递；发送自定义消息后会自动继续下一岗</li>
      </ol>
    </div>
    <div class="actions">
      <button class="btn primary" id="openBoss">打开 BOSS 直聘</button>
    </div>
    <div class="hint">本插件仅在 zhipin.com / bosszhipin.com 生效</div>
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
    <div class="hero">
      <img class="logo" src="../assets/icons/icon128.png" alt="logo" />
      <div class="brand">Boss 海投助手</div>
    </div>
    <div class="status"><span class="dot"></span>已在 BOSS 页面，可使用悬浮插件</div>
    <div class="guide">
      <div class="guide-title">快捷操作</div>
      <ol>
        <li>点击下方按钮打开可拖动悬浮面板</li>
        <li>也可直接点页面右下角圆形悬浮球</li>
        <li>不用时点面板「— / ×」收起成小图标</li>
      </ol>
    </div>
    <div class="actions">
      <button class="btn primary" id="openPanel">打开悬浮面板</button>
      <button class="btn ghost" id="toggleFab">显示/隐藏悬浮球</button>
    </div>
    <div class="footer">
      <span>v${version}</span>
      <span>BOSS 已连接</span>
    </div>
  `;
  async function sendFloat(type) {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/floating-host.js"]
      });
      return chrome.tabs.sendMessage(tab.id, { type });
    }
  }
  document.getElementById("openPanel").addEventListener("click", async () => {
    await sendFloat("BHT_FLOAT_OPEN");
    window.close();
  });
  document.getElementById("toggleFab").addEventListener("click", async () => {
    await sendFloat("BHT_FLOAT_TOGGLE_FAB");
    window.close();
  });
}

try {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  document.documentElement.dataset.theme = stored?.[STORAGE_KEYS.SETTINGS]?.theme === 'light' ? 'light' : 'dark';
} catch (_) {
  document.documentElement.dataset.theme = 'dark';
}

const manifest = chrome.runtime.getManifest();
const version = manifest.version || "1.1.1";
const tab = await getActiveTab();
if (tab && isBossUrl(tab.url || "")) renderBossReady(tab, version);
else renderGuide(version);
