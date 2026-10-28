import { STORAGE_KEYS } from '../shared/constants.js';

let dialog;
let checkbox;
let initialized = false;
let suspended = false;
let openRequest = 0;
let preferenceRequest = 0;
let preferenceWrite = Promise.resolve();
let onError = () => {};
let releaseGate;
let noticeGate = new Promise((resolve) => { releaseGate = resolve; });

function beginGate() {
  if (releaseGate) return;
  noticeGate = new Promise((resolve) => { releaseGate = resolve; });
}

function settleGate() {
  releaseGate?.();
  releaseGate = null;
}

// The tour waits both for the initial storage read and for the notice to close.
export async function waitForUsageNotice() {
  let gate;
  do {
    gate = noticeGate;
    await gate;
  } while (gate !== noticeGate);
}

async function openNotice(force = false) {
  if (!dialog || dialog.open || suspended) return;
  beginGate();
  const request = ++openRequest;
  await preferenceWrite;
  let dismissed = false;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USAGE_NOTICE);
    dismissed = stored?.[STORAGE_KEYS.USAGE_NOTICE]?.dismissed === true;
  } catch (_) {}
  if (request !== openRequest || suspended) return;
  if (dismissed && !force) {
    settleGate();
    return;
  }
  checkbox.checked = dismissed;
  document.getElementById('usageNoticeStatus').hidden = true;
  dialog.querySelector('.usage-notice-body').scrollTop = 0;
  dialog.showModal();
  dialog.querySelector('h2').focus({ preventScroll: true });
}

function savePreference() {
  const dismissed = checkbox.checked;
  const request = ++preferenceRequest;
  const status = document.getElementById('usageNoticeStatus');
  status.hidden = true;
  preferenceWrite = preferenceWrite.then(async () => {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.USAGE_NOTICE]: { dismissed }
      });
    } catch (_) {
      if (request !== preferenceRequest) return;
      const message = '提醒选项保存失败，本次选择未生效。请重新选择后重试。';
      status.textContent = message;
      status.hidden = false;
      onError(message);
    }
  });
}

function closeNotice() {
  if (!dialog?.open) return;
  dialog.close();
  settleGate();
}

export function initUsageNotice(options = {}) {
  if (initialized) return;
  initialized = true;
  onError = options.onError || onError;
  dialog = document.getElementById('usage-notice');
  checkbox = document.getElementById('usageNoticeDismissed');
  if (!dialog || !checkbox) {
    settleGate();
    return;
  }
  checkbox.addEventListener('change', savePreference);
  document.getElementById('btnCloseUsageNotice')?.addEventListener('click', closeNotice);
  document.getElementById('btnUsageNotice')?.addEventListener('click', () => openNotice(true));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeNotice();
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data || {};
    if (data.source !== 'bht-host') return;
    if (data.cmd === 'suspend') {
      suspended = true;
      openRequest += 1;
      if (dialog.open) dialog.close();
      beginGate();
    } else if (data.cmd === 'resume' && suspended) {
      suspended = false;
      openNotice();
    }
  });
  openNotice();
}
