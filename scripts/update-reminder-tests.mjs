import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../extension/shared/constants.js';
import { createUpdateChecker, startUpdateChecks, UPDATE_CHECK_ALARM } from '../extension/background/update-checker.js';
import {
  canRemindUpdate, isNewerVersion, normalizeUpdateState, parseUpdateFeed, safeUpdateReleaseUrl,
  shouldCheckForUpdate, UPDATE_CHECK_INTERVAL_MS, UPDATE_RETRY_INTERVAL_MS, UPDATE_RELEASE_PAGE
} from '../extension/shared/update-policy.js';

let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
const entry = (version, content = '&lt;p&gt;修复 &amp; 改进&lt;/p&gt;') => `<entry>
  <title>AutoCast Release</title>
  <link rel="alternate" href="${UPDATE_RELEASE_PAGE}/tag/${version}"/>
  <updated>2026-10-30T12:00:00Z</updated><content type="html">${content}</content>
</entry>`;
const feed = (...versions) => '<feed>' + versions.map((v) => entry(v)).join('') + '</feed>';
const response = (xml) => ({ ok: true, text: async () => xml });
const newest = { latestVersion: '1.7.44', releaseUrl: `${UPDATE_RELEASE_PAGE}/tag/v1.7.44` };
async function claimAndConfirm(checker, version) {
  const claim = await checker.claimReminder(version);
  if (claim.claimed) assert.equal((await checker.confirmReminder(claim.claimId)).confirmed, true);
  return claim;
}

function fixture(initial = {}, options = {}) {
  const bag = { [STORAGE_KEYS.UPDATE]: structuredClone(initial), bht_settings: { theme: 'light' }, bht_resumes: { profiles: [] } };
  let time = Date.parse('2026-10-30T13:00:00Z');
  let calls = 0;
  let fetcher = async () => response(feed('v1.7.44'));
  const storage = {
    get: async (key) => ({ [key]: structuredClone(bag[key]) }),
    set: async (patch) => Object.assign(bag, structuredClone(patch))
  };
  const create = () => createUpdateChecker({
    storage, currentVersion: '1.7.43', now: () => time,
    fetchFeed: async (...args) => { calls++; return fetcher(...args); }, ...options
  });
  return {
    bag, storage, create, checker: create(),
    get calls() { return calls; }, get time() { return time; },
    advance: (ms) => { time += ms; }, setFetch: (fn) => { fetcher = fn; }
  };
}

await test('numeric versions compare correctly across patch, minor and major boundaries', () => {
  assert.equal(isNewerVersion('v1.7.100', '1.7.99'), true);
  assert.equal(isNewerVersion('1.10.0', '1.9.90'), true);
  assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
  for (const v of ['1.7.43', '1.7.42', '', 'garbage', '1.8.0-beta', '1.8']) {
    assert.equal(isNewerVersion(v, '1.7.43'), false);
  }
});
await test('Atom uses the highest stable tag rather than the first entry or release title', () => {
  const release = parseUpdateFeed(feed('v1.7.44-beta', 'v1.7.43', 'v1.7.44', 'v1.7.45-rc.1'));
  assert.equal(release.latestVersion, '1.7.44');
  assert.equal(release.summary, '修复 & 改进');
  assert.equal(release.publishedAt, '2026-10-30T12:00:00Z');
});
await test('Atom handles reordered single-quoted attributes and CDATA without a DOMParser', () => {
  const xml = entry('v1.7.44', '<![CDATA[<p>更新说明 &#x4e2d;&#25991;</p>]]>')
    .replace(/rel="alternate" href="([^"]+)"/, "href='$1' rel='alternate'");
  assert.equal(parseUpdateFeed(xml).summary, '更新说明 中文');
});
await test('invalid feeds, foreign links, prereleases and malformed tags cannot advertise updates', () => {
  for (const xml of ['', '<html>offline</html>', feed('v1.8.0-beta'),
    feed('v1.7.44').replace('https://github.com/', 'https://evil.example/'),
    feed('%broken')]) {
    assert.throws(() => parseUpdateFeed(xml), /正式版本信息/);
  }
});
await test('cache validation rejects malformed versions, dates, timestamps and external release URLs', () => {
  const state = normalizeUpdateState({ latestVersion: 'bad', publishedAt: 'bad', lastAttemptAt: NaN, lastCheckedAt: -1, releaseUrl: 'javascript:alert(1)' });
  assert.equal(state.latestVersion, '');
  assert.equal(state.publishedAt, '');
  assert.equal(state.lastAttemptAt, 0);
  assert.equal(state.lastCheckedAt, 0);
  assert.equal(state.releaseUrl, UPDATE_RELEASE_PAGE);
  assert.equal(safeUpdateReleaseUrl(`${newest.releaseUrl}?x=1#frag`), newest.releaseUrl);
});
await test('fresh installs check immediately; successful checks wait six hours', async () => {
  const f = fixture();
  assert.equal(shouldCheckForUpdate({}, f.time), true);
  assert.equal((await f.checker.check()).ok, true);
  assert.equal((await f.checker.check()).cached, true);
  assert.equal(f.calls, 1);
  f.advance(UPDATE_CHECK_INTERVAL_MS);
  await f.checker.check();
  assert.equal(f.calls, 2);
});
await test('manual checks bypass the successful cache', async () => {
  const f = fixture();
  await f.checker.check();
  await f.checker.check({ force: true });
  assert.equal(f.calls, 2);
});
await test('concurrent automatic and manual checks share one network request', async () => {
  const f = fixture();
  let release;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  f.setFetch(() => new Promise((resolve) => { release = resolve; signalStarted(); }));
  const checks = [f.checker.check(), f.checker.check({ force: true }), f.checker.check()];
  await started;
  release(response(feed('v1.7.44')));
  assert.ok((await Promise.all(checks)).every((r) => r.ok));
  assert.equal(f.calls, 1);
});
await test('HTTP failures keep the cached badge and throttle automatic retries for thirty minutes', async () => {
  const f = fixture(newest);
  f.setFetch(async () => ({ ok: false, status: 503 }));
  const failed = await f.checker.check();
  assert.equal(failed.ok, false);
  assert.equal(failed.message, 'HTTP 503');
  assert.equal(failed.state.latestVersion, '1.7.44');
  assert.equal((await f.checker.check()).cached, true);
  f.advance(UPDATE_RETRY_INTERVAL_MS);
  await f.checker.check();
  assert.equal(f.calls, 2);
});
await test('manual retry is available during the automatic failure cooldown', async () => {
  const f = fixture();
  f.setFetch(async () => { throw new Error('offline'); });
  await f.checker.check();
  f.setFetch(async () => response(feed('v1.7.44')));
  assert.equal((await f.checker.check({ force: true })).ok, true);
  assert.equal(f.calls, 2);
});
await test('malformed network responses are failures and do not erase a known release', async () => {
  const f = fixture(newest);
  f.setFetch(async () => response('<html>gateway error</html>'));
  const result = await f.checker.check();
  assert.equal(result.ok, false);
  assert.equal(result.state.latestVersion, '1.7.44');
  assert.equal(result.state.lastCheckedAt, 0);
});
await test('a stalled request is bounded and its signal is aborted', async () => {
  let timeoutCallback, signal;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const f = fixture({}, { setTimer: (fn) => { timeoutCallback = fn; return 1; }, clearTimer: () => {} });
  f.setFetch(async (_url, options) => { signal = options.signal; signalStarted(); return new Promise(() => {}); });
  const pending = f.checker.check();
  await started;
  timeoutCallback();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.message, '检查更新超时');
  assert.equal(signal.aborted, true);
});
await test('service worker restarts retain check cooldown and previously notified versions', async () => {
  const f = fixture();
  await f.checker.check();
  await claimAndConfirm(f.checker, '1.7.44');
  const restarted = f.create();
  assert.equal((await restarted.check()).cached, true);
  assert.equal((await restarted.claimReminder('1.7.44')).claimed, false);
  assert.equal(f.calls, 1);
});
await test('worker restarts also retain failed-attempt cooldown', async () => {
  const f = fixture();
  f.setFetch(async () => { throw new Error('offline'); });
  await f.checker.check();
  assert.equal((await f.create().check()).cached, true);
  assert.equal(f.calls, 1);
});
await test('multiple panels can claim a new version only once', async () => {
  const f = fixture(newest);
  const claims = await Promise.all(Array.from({ length: 8 }, () => f.checker.claimReminder('1.7.44')));
  assert.equal(claims.filter((r) => r.claimed).length, 1);
  assert.equal(f.bag[STORAGE_KEYS.UPDATE].notifiedVersion, '');
  assert.equal((await f.checker.confirmReminder(claims.find((r) => r.claimed).claimId)).confirmed, true);
  assert.equal(f.bag[STORAGE_KEYS.UPDATE].notifiedVersion, '1.7.44');
});
await test('a stale panel cannot consume the reminder for a different version', async () => {
  const f = fixture(newest);
  assert.equal((await f.checker.claimReminder('1.7.45')).claimed, false);
  assert.equal((await f.checker.claimReminder('1.7.44')).claimed, true);
});
await test('a later version receives its own reminder after an older reminder was dismissed', async () => {
  const f = fixture(newest);
  await claimAndConfirm(f.checker, '1.7.44');
  f.setFetch(async () => response(feed('v1.7.45')));
  await f.checker.check({ force: true });
  assert.equal((await claimAndConfirm(f.checker, '1.7.45')).claimed, true);
  assert.equal((await f.checker.claimReminder('1.7.45')).claimed, false);
});
await test('an installed version that catches up removes reminder eligibility without deleting user settings', async () => {
  const f = fixture(newest, { currentVersion: '1.7.44' });
  assert.equal((await f.checker.claimReminder('1.7.44')).claimed, false);
  assert.deepEqual(f.bag.bht_settings, { theme: 'light' });
  assert.deepEqual(f.bag.bht_resumes, { profiles: [] });
  assert.equal(canRemindUpdate(newest, '1.7.45'), false);
});
await test('a rolled-back release is not notified a second time', () => {
  assert.equal(canRemindUpdate({ ...newest, notifiedVersion: '1.7.45' }, '1.7.43'), false);
});
await test('clock rollback recovers instead of postponing checks indefinitely', () => {
  assert.equal(shouldCheckForUpdate({ lastCheckedAt: 3000, lastAttemptAt: 3000 }, 1000), true);
});
await test('notification writes queue after an in-flight check without losing the notified version', async () => {
  const f = fixture(newest);
  const [checked, claimed] = await Promise.all([f.checker.check(), f.checker.claimReminder('1.7.44')]);
  assert.equal(checked.ok, true);
  assert.equal(claimed.claimed, true);
  await f.checker.confirmReminder(claimed.claimId);
  assert.equal(f.bag[STORAGE_KEYS.UPDATE].notifiedVersion, '1.7.44');
});
await test('failed notification storage writes do not claim the reminder and a retry can succeed', async () => {
  const f = fixture(newest);
  const save = f.storage.set;
  f.storage.set = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(f.checker.claimReminder('1.7.44'), /storage unavailable/);
  f.storage.set = save;
  assert.equal((await f.checker.claimReminder('1.7.44')).claimed, true);
});
await test('a panel hidden before the claim reply cancels without consuming its notification', async () => {
  const f = fixture(newest);
  const claim = await f.checker.claimReminder('1.7.44');
  assert.equal(claim.claimed, true);
  assert.equal(f.bag[STORAGE_KEYS.UPDATE].notifiedVersion, '');
  assert.equal((await f.checker.cancelReminder(claim.claimId)).cancelled, true);
  assert.equal(f.bag[STORAGE_KEYS.UPDATE].notifiedVersion, '');
  assert.equal((await claimAndConfirm(f.checker, '1.7.44')).claimed, true);
});
await test('an unconfirmed reservation survives restart and expires without suppressing a later reminder', async () => {
  const f = fixture(newest);
  const claim = await f.checker.claimReminder('1.7.44');
  const restarted = f.create();
  assert.equal((await restarted.claimReminder('1.7.44')).claimed, false);
  f.advance(30001);
  assert.equal((await restarted.confirmReminder(claim.claimId)).confirmed, false);
  assert.equal((await claimAndConfirm(restarted, '1.7.44')).claimed, true);
});
await test('another panel cannot cancel or confirm a reservation with the wrong receipt', async () => {
  const f = fixture(newest);
  const claim = await f.checker.claimReminder('1.7.44');
  assert.equal((await f.checker.cancelReminder('wrong-id')).cancelled, false);
  assert.equal((await f.checker.confirmReminder('wrong-id')).confirmed, false);
  assert.equal((await f.checker.confirmReminder(claim.claimId)).confirmed, true);
  assert.equal((await f.checker.cancelReminder(claim.claimId)).cancelled, false);
});
await test('a delayed old reservation cannot consume a later release reminder', async () => {
  const f = fixture(newest);
  const claim = await f.checker.claimReminder('1.7.44');
  f.setFetch(async () => response(feed('v1.7.45')));
  await f.checker.check({ force: true });
  assert.equal((await f.checker.confirmReminder(claim.claimId)).confirmed, false);
  assert.equal((await claimAndConfirm(f.checker, '1.7.45')).claimed, true);
});
await test('startup registers a persistent alarm and routes only the update alarm to the checker', async () => {
  const event = () => ({ listener: null, addListener(fn) { this.listener = fn; } });
  const runtime = { onStartup: event(), onInstalled: event() };
  const alarmEvent = event();
  let existing, creations = 0, checks = 0;
  const browser = { runtime, alarms: {
    get: async () => existing,
    create: async (name, options) => { creations++; existing = { name, ...options }; },
    onAlarm: alarmEvent
  } };
  startUpdateChecks(browser, { check: async () => { checks++; } });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(existing.name, UPDATE_CHECK_ALARM);
  assert.equal(existing.periodInMinutes, 360);
  runtime.onStartup.listener();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(creations, 1);
  const before = checks;
  alarmEvent.listener({ name: 'bht_delivery_schedule' });
  assert.equal(checks, before);
  alarmEvent.listener({ name: UPDATE_CHECK_ALARM });
  assert.equal(checks, before + 1);
});
console.log(`Update reminder tests: ${passed} passed.`);
