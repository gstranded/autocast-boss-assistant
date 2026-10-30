import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  getAllConfig, importAll, normalizeFilters, normalizeSettings, saveSettings
} from '../extension/shared/storage.js';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../extension/shared/constants.js';
import { checkLimits } from '../extension/shared/dedup.js';
import { classifyActive, evaluateJob, matchActive } from '../extension/shared/filter-engine.js';

const content = fs.readFileSync(new URL('../extension/content/content-main.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../extension/sidepanel/app.js', import.meta.url), 'utf8');
const cases = [];
const test = (name, run) => cases.push({ name, run });
function bind(source, start, end, context) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `function boundary: ${start}`);
  return new Function(...Object.keys(context), `return (${source.slice(begin, finish).trim()});`)(...Object.values(context));
}

function createContentHarness(scenario = '') {
  let clock = 1000;
  let clicks = 0;
  let receipt = false;
  let modal = null;
  let noticeClicks = 0;
  let scheduled = false;
  const button = { textContent: '立即沟通', disabled: false, getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 30 }) };
  const title = { textContent: 'Fixture Job' };
  function showModal(hard, text = '') {
    const confirm = { ...button, textContent: hard ? '确定' : '好', onClick: () => {
      if (!hard) {
        noticeClicks++;
        if (scenario === 'near-blocked') return;
        receipt = true;
      }
      modal = null;
    } };
    modal = { textContent: text || '您已达到沟通上限，休息一下，明天再来吧',
      getBoundingClientRect: () => ({ width: 320, height: 180 }),
      querySelectorAll: () => [confirm] };
  }
  const document = {
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'button,a,.btn' ? [button] : modal ? [modal] : []
  };
  const context = {
    document, window: {}, BHT_CONTENT_VERSION: '1.7.43',
    location: { pathname: '/job_detail/fixture', href: 'https://fixture.invalid/job_detail/fixture', hash: '' },
    SELECTORS: { detailRoot: ['root'], title: ['title'] },
    Date: { now: () => clock },
    getComputedStyle: (node) => ({ display: node.display || 'block', visibility: 'visible', opacity: '1' }),
    firstEl: (keys) => keys[0] === 'title' ? title : document,
    textOf: (node) => String(node?.textContent || '').replace(/\s+/g, ' ').trim(),
    findConversationActionButton: () => button,
    findExistingBossJobSwitchDialog: () => null, skipExistingBossJobSwitch: () => null,
    detectLoginModal: () => ({ ok: false }), detectNonChatJob: () => null,
    clickStayOnListDialog: () => ({ ok: true }),
    closeSubscribeDialogAndConfirmConversation: async () => ({ closed: false, available: scenario === 'hard-delayed-subscribe' }),
    extractDetailHrName: () => 'Fixture HR', extractDetailCompany: () => 'Fixture Company',
    isConversationNavigationStarted: () => false,
    debugTrace: () => {}, describeDebugElement: () => ({}), pageInfo: () => ({}),
    findNativeGreetingReceipt: () => receipt ? { at: clock, greeting: 'hello', hasShowGreeting: true, showGreeting: true } : null,
    clickLikeHuman: (node) => {
      if (node === button) {
        clicks++;
        if (scenario === 'hard-first' || (scenario === 'hard-retry' && clicks === 2)) showModal(true);
        if (scenario.startsWith('near-') && clicks === 1 && scenario !== 'near-delayed') {
          showModal(false, '您今天已与 120 位 BOSS 沟通，还剩 30 次沟通机会哦');
        }
        if (scenario === 'success') receipt = true;
      } else node.onClick?.();
      return true;
    },
    sleep: async (ms) => {
      clock += ms;
      if (!scheduled && ((scenario.startsWith('hard-delayed') && clock >= 1300) ||
          (scenario === 'hard-retry-delayed' && clicks === 2 && clock >= 4500))) {
        scheduled = true;
        showModal(true);
      }
      if (!scheduled && scenario === 'near-delayed' && clock >= 1300) {
        scheduled = true;
        showModal(false, '您今天已与\n120 位\nBOSS 沟通，还剩\n30 次沟通机会哦');
      }
    }
  };
  context.detectBossDailyLimitModal = bind(content, 'function detectBossDailyLimitModal(', '// BOSS 在接近每日上限', context);
  if (scenario === 'hard-delayed-subscribe') {
    const detect = context.detectBossDailyLimitModal;
    context.detectBossDailyLimitModal = () => {
      const result = detect();
      if (result.ok) modal = null;
      return result;
    };
  }
  context.findBossCommunicationQuotaNotice = bind(content, 'function findBossCommunicationQuotaNotice(', 'async function closeBossCommunicationQuotaNotice(', context);
  context.closeBossCommunicationQuotaNotice = bind(content, 'async function closeBossCommunicationQuotaNotice(', 'async function waitForBossCommunicationQuotaNotice(', context);
  context.dismissCommonDialogs = bind(content, 'function dismissCommonDialogs(', 'function isChatPage(', context);
  context.waitForNativeGreetingReceipt = bind(content, 'async function waitForNativeGreetingReceipt(', 'function buildTriggerNavigationRecovery(', context);
  return { context, button, showModal,
    trigger: bind(content, 'async function triggerConversationOnWorkerDetail(', 'async function triggerConversationOnList(', context),
    get clicks() { return clicks; }, get noticeClicks() { return noticeClicks; }
  };
}

for (const [scenario, expectedClicks] of [
  ['hard-initial', 0], ['hard-first', 1], ['hard-delayed', 1],
  ['hard-retry', 2], ['hard-retry-delayed', 2]
]) test(`worker stops at ${scenario}`, async () => {
  const harness = createContentHarness(scenario);
  if (scenario === 'hard-initial') harness.showModal(true);
  const result = await harness.trigger({ jobId: 'fixture' });
  assert.equal(result.error, 'BOSS_DAILY_LIMIT');
  assert.equal(harness.clicks, expectedClicks);
  assert.equal(harness.context.detectBossDailyLimitModal().ok, true, 'terminal modal remains visible');
});

test('dialog cleanup does not click a normal continue-chat button', () => {
  const harness = createContentHarness();
  harness.button.textContent = '继续沟通';
  assert.equal(harness.context.dismissCommonDialogs(), false);
  assert.equal(harness.clicks, 0);
});

test('dialog cleanup uses only visible exact confirmation labels', () => {
  const harness = createContentHarness();
  let count = 0;
  const candidate = { textContent: '确定', getBoundingClientRect: () => ({ width: 100, height: 30 }),
    onClick: () => count++ };
  const root = { getBoundingClientRect: () => ({ width: 320, height: 180 }), querySelectorAll: () => [candidate] };
  harness.context.document.querySelectorAll = () => [root];
  const cleanup = bind(content, 'function dismissCommonDialogs(', 'function isChatPage(', {
    ...harness.context, detectBossDailyLimitModal: () => ({ ok: false })
  });
  root.display = 'none';
  assert.equal(cleanup(), false);
  root.display = 'block';
  candidate.textContent = '继续沟通';
  assert.equal(cleanup(), false);
  candidate.textContent = '确定';
  assert.equal(cleanup(), true);
  assert.equal(count, 1);
  assert.equal(harness.clicks, 0);
});

for (const text of [
  '您今天已与120位BOSS沟通，还剩30次沟通机会哦',
  '您今天已与 120 位 BOSS 沟通，还剩 30 次沟通机会哦',
  '您今天已与\n120 位\nBOSS\n沟通，还剩\n30 次沟通机会哦'
]) test(`quota notice recognizes ${JSON.stringify(text)}`, async () => {
  const harness = createContentHarness();
  harness.showModal(false, text);
  assert.ok(harness.context.findBossCommunicationQuotaNotice());
  assert.equal(harness.context.detectBossDailyLimitModal().ok, false);
  assert.equal((await harness.context.closeBossCommunicationQuotaNotice()).closed, true);
  assert.equal(harness.noticeClicks, 1);
});

for (const scenario of ['near-first', 'near-delayed', 'success']) test(`worker retains normal success for ${scenario}`, async () => {
  const harness = createContentHarness(scenario);
  const result = await harness.trigger({ jobId: 'fixture' });
  assert.equal(result.ok, true);
  assert.equal(harness.clicks, 1);
});

test('worker does not retry beneath an undismissed quota notice', async () => {
  const harness = createContentHarness('near-blocked');
  assert.equal((await harness.trigger({ jobId: 'fixture' })).error, 'CONVERSATION_CREATE_NOT_CONFIRMED');
  assert.equal(harness.clicks, 1);
});

test('worker still reports bounded no-effect failures without a modal', async () => {
  const harness = createContentHarness();
  assert.equal((await harness.trigger({ jobId: 'fixture' })).error, 'WORKER_CHAT_CLICK_NO_EFFECT');
  assert.equal(harness.clicks, 2);
});

test('captured daily limit survives modal removal and a provisional subscription receipt', async () => {
  const harness = createContentHarness('hard-delayed-subscribe');
  assert.equal((await harness.trigger({ jobId: 'fixture' })).error, 'BOSS_DAILY_LIMIT');
  assert.equal(harness.clicks, 1);
});

test('invalid stored limits recover to 150 and cannot bypass limits', () => {
  for (const value of [-1, 1.5, NaN, Infinity, 'invalid', '', true, {}]) {
    const settings = normalizeSettings({ taskMaxCommunicate: value, dailyMaxCommunicate: value });
    assert.equal(settings.taskMaxCommunicate, 150);
    assert.equal(settings.dailyMaxCommunicate, 150);
    assert.equal(checkLimits({ settings: { taskMaxCommunicate: 10, dailyMaxCommunicate: value },
      taskSuccessCount: 0, todayStats: { communicate: 999 } }).ok, false);
  }
  const settings = normalizeSettings({ taskMaxCommunicate: '42', dailyMaxCommunicate: 0 });
  assert.equal(settings.taskMaxCommunicate, 42);
  assert.equal(settings.dailyMaxCommunicate, 0);
});

async function withStorage(run) {
  const previous = globalThis.chrome;
  const stored = { [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS }, [STORAGE_KEYS.FILTERS]: normalizeFilters({}) };
  let writes = 0;
  globalThis.chrome = { storage: { local: {
    get: async (keys) => Object.fromEntries((keys == null ? Object.keys(stored) : Array.isArray(keys) ? keys : [keys])
      .filter((key) => key in stored).map((key) => [key, structuredClone(stored[key])])),
    set: async (patch) => { writes++; Object.assign(stored, structuredClone(patch)); }
  } } };
  try { await run(stored, () => writes); } finally { globalThis.chrome = previous; }
}

test('settings saves reject negative and fractional limits without writing', async () => withStorage(async (stored, writes) => {
  for (const value of [-1, 1.5, Infinity]) {
    await assert.rejects(saveSettings({ dailyMaxCommunicate: value }), /整数/);
    await assert.rejects(saveSettings({ taskMaxCommunicate: value }), /整数/);
  }
  assert.equal(writes(), 0);
  await saveSettings({ dailyMaxCommunicate: 0, taskMaxCommunicate: 42 });
  assert.equal(stored[STORAGE_KEYS.SETTINGS].dailyMaxCommunicate, 0);
  await saveSettings({ dailyMaxCommunicate: '', taskMaxCommunicate: '' });
  assert.equal(stored[STORAGE_KEYS.SETTINGS].dailyMaxCommunicate, 150);
}));

for (const bad of [
  { filters: { title: { or: 'Java' } } },
  { filters: { location: { include: '广州' } } },
  { filters: { company: { not: [42] } } },
  { filters: { title: { enabled: { or: 'yes' } } } },
  { messageTemplate: { segments: 'hello' } },
  { resumes: { profiles: [{ images: 'broken' }] } },
  { bindings: { rules: [{ keywords: 'Java' }] } },
  { lists: { companyBlacklist: 'company' } },
  { history: 'broken' },
  { dailyStats: { today: { byCompany: [] } } },
  { idempotency: [] },
  { task: { results: [{ job: 'broken' }] } },
  { settings: { dailyMaxCommunicate: -1 } }
]) test(`import rejects all writes for ${JSON.stringify(bad)}`, async () => withStorage(async (stored, writes) => {
  const before = structuredClone(stored);
  await assert.rejects(importAll({ settings: { theme: 'light' }, ...bad }));
  assert.equal(writes(), 0);
  assert.deepEqual(stored, before);
}));

test('valid legacy import migrates AND and message roles while preserving custom limits', async () => withStorage(async () => {
  const result = await importAll({
    settings: { taskMaxCommunicate: 42, dailyMaxCommunicate: 0 },
    filters: { title: { or: ['Java'], and: ['retired'], enabled: { and: true } }, activeWithin: 'week' },
    messageTemplate: { segments: [{ text: 'hello' }, { text: 'supplement' }] },
    task: { status: 'running', results: [{ decision: 'pass', job: { jobId: 'fixture' } }] }
  });
  assert.equal(result.settings.taskMaxCommunicate, 42);
  assert.equal(result.settings.dailyMaxCommunicate, 0);
  assert.equal(result.filters.title.and, undefined);
  assert.equal(result.messageTemplate.segments[1].kind, 'supplement');
  assert.equal(result.task.status, 'awaiting_confirm');
}));

test('previously corrupted keyword storage heals before job evaluation', async () => withStorage(async (stored) => {
  stored[STORAGE_KEYS.FILTERS] = { title: { or: 'Java' }, location: { include: '广州' } };
  const config = await getAllConfig();
  assert.ok(Array.isArray(config.filters.title.or));
  assert.doesNotThrow(() => evaluateJob({ title: 'Java', company: 'Fixture', activeText: '今日活跃' }, config.filters));
}));

test('activity day boundaries use their actual ceiling', () => {
  for (const [days, expected] of [
    [0, 'today'], [1, '3d'], [3, '3d'], [4, 'week'], [7, 'week'], [8, '2w'], [14, '2w'],
    [15, 'month'], [30, 'month'], [31, '2m'], [60, '2m'], [61, '3m'], [90, '3m'],
    [91, '4m'], [120, '4m'], [121, 'half'], [180, 'half'], [181, 'year'], [365, 'year']
  ]) assert.equal(classifyActive(`${days}日前活跃`), expected, `${days} days`);
  assert.equal(matchActive('3日前活跃', ['3d']), true);
  for (const days of [4, 7, 14, 30]) assert.equal(matchActive(`${days}日前活跃`, ['3d']), false);
  assert.equal(matchActive('7天前活跃', ['week']), true);
  assert.equal(matchActive('8天前活跃', ['week']), false);
});

function capacityCheck({ unlimited = false, total = 0, previous = 0, permissionError = false } = {}) {
  const chrome = { permissions: { contains: async () => {
    if (permissionError) throw new Error('unavailable');
    return unlimited;
  } }, storage: { local: { QUOTA_BYTES: 10 * 1024 * 1024,
    getBytesInUse: async (key) => key === 'bht_resumes' ? previous : total } } };
  return bind(app, 'async function assertResumeStorageCapacity(', 'async function fileToCompressedDataUrl(', {
    chrome, globalThis: { chrome }, getJsonBytes: (data) => data.bytes
  });
}

test('unlimitedStorage accepts 10 MiB despite the unchanged quota constant', async () => {
  await capacityCheck({ unlimited: true, total: 15 * 1024 * 1024 })({ bytes: 10 * 1024 * 1024 });
});
test('unlimitedStorage still rejects resumes above the 40 MiB soft limit', async () => {
  await assert.rejects(capacityCheck({ unlimited: true })({ bytes: 41 * 1024 * 1024 }), /简历数据过大/);
});
test('limited storage uses projected bytes including replacement credit', async () => {
  await assert.rejects(capacityCheck()({ bytes: 10 * 1024 * 1024 }), /存储空间不足/);
  await capacityCheck({ total: 9 * 1024 * 1024, previous: 8 * 1024 * 1024 })({ bytes: 8 * 1024 * 1024 });
});
test('missing permission metadata leaves actual storage failure handling available', async () => {
  await capacityCheck({ permissionError: true })({ bytes: 10 * 1024 * 1024 });
});

let passed = 0;
for (const { name, run } of cases) {
  try { await run(); passed++; console.log('  PASS', name); }
  catch (error) { console.error('  FAIL', name, error.stack); process.exitCode = 1; }
}
console.log(`Audit regressions: ${passed}/${cases.length} passed`);
