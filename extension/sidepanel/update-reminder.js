import { STORAGE_KEYS } from '../shared/constants.js';
import { MSG } from '../shared/messaging.js';
import {
  canRemindUpdate,
  isNewerVersion,
  normalizeUpdateState,
  UPDATE_HOME_PAGE,
  UPDATE_RELEASE_PAGE
} from '../shared/update-policy.js';

export function initUpdateReminder({ currentVersion, isSuspended = () => false }) {
  const $ = (id) => document.getElementById(id);
  const button = $('btnCheckUpdate');
  if (!button) return;
  let cached = normalizeUpdateState();
  let claiming = false;
  let manualChecking = false;
  let reminderTimer;
  let shownVersion = '';
  $('updateCurrentVersion').textContent = 'v' + currentVersion;

  const request = (type, payload) => chrome.runtime.sendMessage({ type, payload });
  const openLink = (url) => (event) => {
    event.preventDefault();
    try { chrome.tabs.create({ url, active: true }); } catch (_) {}
  };
  $('btnRepoHome')?.addEventListener('click', openLink(UPDATE_HOME_PAGE));

  function closeReminder() {
    clearTimeout(reminderTimer);
    $('updateReminder').hidden = true;
  }

  function renderStatus() {
    const status = $('updateStatus');
    status.replaceChildren();
    status.hidden = !cached.latestVersion;
    if (status.hidden) return;
    const newer = isNewerVersion(cached.latestVersion, currentVersion);
    const line = document.createElement('div');
    line.textContent = newer
      ? `发现新版本 v${cached.latestVersion}（当前 v${currentVersion}）。`
      : `已是最新版本（v${currentVersion}）。`;
    if (cached.publishedAt) {
      line.textContent += ' · ' + new Date(cached.publishedAt).toLocaleDateString('zh-CN') + ' 发布';
    }
    status.appendChild(line);
    if (newer && cached.summary) {
      const summary = document.createElement('div');
      summary.textContent = cached.summary;
      status.appendChild(summary);
    }
    const links = document.createElement('div');
    links.className = 'update-links';
    for (const [text, url] of [
      [newer ? '查看更新 ›' : '更新日志 ›', cached.releaseUrl || UPDATE_RELEASE_PAGE],
      ['项目主页 ›', UPDATE_HOME_PAGE]
    ]) {
      const link = document.createElement('a');
      link.textContent = text;
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.addEventListener('click', openLink(url));
      links.appendChild(link);
    }
    status.appendChild(links);
  }

  function render(value) {
    cached = normalizeUpdateState(value);
    const newer = isNewerVersion(cached.latestVersion, currentVersion);
    const badge = $('updateVersionBadge');
    badge.hidden = !newer;
    badge.textContent = newer ? `新版本 v${cached.latestVersion}` : '';
    $('settingsUpdateDot').hidden = !newer;
    $('settingsUpdateDot').title = newer ? `有新版本 v${cached.latestVersion}` : '';
    if (!newer || (shownVersion && shownVersion !== cached.latestVersion)) closeReminder();
    if (!manualChecking) renderStatus();
  }

  function visibleForReminder() {
    return !document.hidden && !isSuspended() &&
      !document.querySelector('dialog[open]') && $('bht-modal')?.hidden !== false;
  }

  async function maybeNotify() {
    if (claiming || !visibleForReminder() || !canRemindUpdate(cached, currentVersion)) return;
    if (cached.pendingReminder?.version === cached.latestVersion && cached.pendingReminder.expiresAt > Date.now()) return;
    claiming = true;
    let claimId = '';
    try {
      const result = await request(MSG.CLAIM_UPDATE_REMINDER, { version: cached.latestVersion });
      if (result?.state) render(result.state);
      if (result?.claimed) {
        claimId = result.claimId;
        if (!visibleForReminder()) {
          const cancelled = await request(MSG.CANCEL_UPDATE_REMINDER, { claimId });
          claimId = '';
          if (cancelled?.state) render(cancelled.state);
          return;
        }
        shownVersion = cached.latestVersion;
        $('updateReminderText').textContent = `v${shownVersion} 已发布，可在「设置」查看更新。`;
        $('updateReminder').hidden = false;
        clearTimeout(reminderTimer);
        reminderTimer = setTimeout(closeReminder, 12000);
        const confirmed = await request(MSG.CONFIRM_UPDATE_REMINDER, { claimId });
        if (confirmed?.state) render(confirmed.state);
        if (!confirmed?.confirmed) closeReminder();
        else claimId = '';
      }
    } catch (_) {
      if (claimId) closeReminder();
      // Background restarts and automatic checks must not interrupt delivery.
    } finally {
      if (claimId) {
        try {
          const cancelled = await request(MSG.CANCEL_UPDATE_REMINDER, { claimId });
          if (cancelled?.state) render(cancelled.state);
        } catch (_) {}
      }
      claiming = false;
    }
  }

  $('btnCloseUpdateReminder')?.addEventListener('click', closeReminder);
  $('btnViewUpdate')?.addEventListener('click', () => {
    closeReminder();
    document.querySelector('#tabs [data-tab="settings"]')?.click();
    $('updateCard')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  document.addEventListener('visibilitychange', () => { maybeNotify(); });
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.UPDATE]) return;
    render(changes[STORAGE_KEYS.UPDATE].newValue);
    maybeNotify();
  });
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    manualChecking = true;
    $('updateStatus').hidden = false;
    $('updateStatus').textContent = '正在检查更新…';
    try {
      const result = await request(MSG.CHECK_UPDATE, { force: true });
      if (result?.state) render(result.state);
      if (!result?.ok) throw new Error(result?.message || '后台暂时不可用');
      renderStatus();
      maybeNotify();
    } catch (error) {
      $('updateStatus').textContent = '检查失败：' + String(error?.message || error) + '（请检查网络后重试）';
    } finally {
      manualChecking = false;
      button.disabled = false;
    }
  });

  (async () => {
    try {
      const bag = await chrome.storage.local.get(STORAGE_KEYS.UPDATE);
      render(bag?.[STORAGE_KEYS.UPDATE]);
      maybeNotify();
      const result = await request(MSG.CHECK_UPDATE, { force: false });
      if (result?.state) render(result.state);
      maybeNotify();
    } catch (_) {}
  })();
  return { maybeNotify };
}
