import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../extension/shared/page-clock.js';
import { attachPageClock } from '../extension/background/page-clock.js';
import { activateBackgroundTab, backgroundWorkspaceProblem, navigateBackgroundTab, prepareBackgroundWorkspace } from '../extension/background/execution-workspace.js';
import { normalizeSettings } from '../extension/shared/storage.js';

let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
const event = () => {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), fire: value => listeners.forEach(fn => fn(value)) };
};
function pair() {
  const client = { onMessage: event(), onDisconnect: event() };
  const server = { name: 'bht-page-clock', sender: { frameId: 0, tab: { url: 'https://www.zhipin.com/web/geek/jobs' } }, onMessage: event(), onDisconnect: event() };
  client.postMessage = msg => queueMicrotask(() => server.onMessage.fire(msg));
  server.postMessage = msg => queueMicrotask(() => client.onMessage.fire(msg));
  client.disconnect = server.disconnect = () => { client.onDisconnect.fire(); server.onDisconnect.fire(); };
  return { client, server };
}

await test('existing settings get background delivery; an explicit opt-out survives normalization', () => {
  assert.equal(normalizeSettings({ splitViewEnabled: true }).backgroundDeliveryEnabled, true);
  assert.equal(normalizeSettings({ backgroundDeliveryEnabled: false }).backgroundDeliveryEnabled, false);
});

await test('hidden-page waits are answered by worker timers, with no page timer', async () => {
  const ports = pair();
  attachPageClock(ports.server, { allowSender: () => true });
  const clock = BHTPageClock.createPageClock({ connect: () => ports.client, isHidden: () => true, setTimer: () => { throw new Error('Hidden page timer used'); } });
  await clock.sleep(5, 'job');
  clock.dispose();
});

await test('long waits are split into bounded worker requests without losing elapsed duration', async () => {
  const ports = pair(), durations = [];
  attachPageClock(ports.server, { allowSender: () => true, setTimer: (fn, ms) => { durations.push(ms); queueMicrotask(fn); return 1; }, clearTimer: () => {} });
  const clock = BHTPageClock.createPageClock({ connect: () => ports.client, isHidden: () => true });
  await clock.sleep(4500, 'job');
  assert.deepEqual(durations, [2000, 2000, 500]);
  clock.dispose();
});

await test('cancellation rejects a hidden wait before a late worker acknowledgement', async () => {
  const ports = pair(), callbacks = [];
  attachPageClock(ports.server, { allowSender: () => true, setTimer: fn => { callbacks.push(fn); return 1; }, clearTimer: () => {} });
  const clock = BHTPageClock.createPageClock({ connect: () => ports.client, isHidden: () => true });
  let continued = false;
  const waiting = clock.sleep(1000, 'stopped-job').then(() => { continued = true; });
  const rejected = assert.rejects(waiting, { code: 'OP_CANCELLED' });
  await Promise.resolve();
  clock.cancel('stopped-job');
  await rejected;
  callbacks.forEach(fn => fn());
  await Promise.resolve();
  assert.equal(continued, false);
  clock.dispose();
});

await test('visible-page cancellation clears its timer as well', async () => {
  const cleared = [];
  const clock = BHTPageClock.createPageClock({ isHidden: () => false, setTimer: () => 42, clearTimer: id => cleared.push(id) });
  const waiting = clock.sleep(1000, 'job');
  const rejected = assert.rejects(waiting, { code: 'OP_CANCELLED' });
  clock.cancel('job');
  await rejected;
  assert.deepEqual(cleared, [42]);
});

await test('disconnection fails the wait safely; the next wait reconnects', async () => {
  let connects = 0, first;
  const clock = BHTPageClock.createPageClock({
    isHidden: () => true,
    connect: () => {
      connects++;
      const ports = pair();
      if (connects === 1) { first = ports; attachPageClock(ports.server, { allowSender: () => true, setTimer: () => 1, clearTimer: () => {} }); }
      else attachPageClock(ports.server, { allowSender: () => true });
      return ports.client;
    }
  });
  const waiting = clock.sleep(1000, 'job');
  const rejected = assert.rejects(waiting, { code: 'PAGE_CLOCK_DISCONNECTED' });
  first.client.disconnect();
  await rejected;
  await clock.sleep(1, 'next-job');
  assert.equal(connects, 2);
  clock.dispose();
});

await test('worker refuses invalid wait budgets and unauthorized senders', async () => {
  const ports = pair(), replies = [];
  ports.client.onMessage.addListener(msg => replies.push(msg));
  attachPageClock(ports.server, { allowSender: () => true, setTimer: () => { throw new Error('Invalid timer scheduled'); } });
  ports.client.postMessage({ id: 1, waitMs: 60000 });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(replies[0].error, 'PAGE_CLOCK_BAD_REQUEST');
  let closed = false;
  const denied = pair(); denied.client.onDisconnect.addListener(() => { closed = true; });
  attachPageClock(denied.server, { allowSender: () => false });
  assert.equal(closed, true);
});

function workspaceFixture() {
  const list = { id: 10, windowId: 1, url: 'https://www.zhipin.com/web/geek/jobs?query=ops', instance: 'original-list', active: false };
  const other = { id: 11, windowId: 1, url: 'https://example.com/', active: true };
  const tabs = new Map([[10, list], [11, other]]), windows = new Map([[1, { id: 1, state: 'normal', focused: true, left: 0, top: 0, width: 1200, height: 850 }]]), calls = [];
  let nextWindowId = 2;
  let nextTabId = 12;
  const browser = {
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('closed'); return tabs.get(id); },
      query: async ({ windowId } = {}) => Array.from(tabs.values()).filter(tab => windowId == null || tab.windowId === windowId),
      move: async (id, { windowId }) => { const tab = tabs.get(id); if (!tab) throw new Error('closed'); tab.windowId = windowId; return tab; },
        remove: async id => { calls.push({ api: 'tabs.remove', id }); if (!tabs.delete(id)) throw new Error('closed'); },
      update: async (id, patch) => { calls.push({ api: 'tabs.update', id, patch }); Object.assign(tabs.get(id), patch); return tabs.get(id); }
    },
    windows: {
      get: async id => { if (!windows.has(id)) throw new Error('closed'); return windows.get(id); },
      update: async (id, patch) => { calls.push({ api: 'windows.update', id, patch }); const win = windows.get(id); Object.assign(win, patch); return win; },
      create: async options => {
        calls.push({ api: 'windows.create', options });
        const id = nextWindowId++;
        const moved = options.tabId != null ? tabs.get(options.tabId) : null;
        const tab = moved || { id: nextTabId++, windowId: id, url: options.url || 'chrome://newtab/', pendingUrl: options.url || '', active: true };
        tab.windowId = id;
        if (options.url) {
          tab.url = options.url;
          tab.pendingUrl = options.url;
        }
        const win = { id, state: 'normal', focused: options.focused === true, left: options.left, top: options.top, width: options.width, height: options.height, tabs: [tab] };
        windows.set(id, win); tabs.set(tab.id, tab);
        return win;
      },
      remove: async id => { calls.push({ api: 'windows.remove', id }); windows.delete(id); for (const [tabId, tab] of tabs) if (tab.windowId === id) tabs.delete(tabId); }
    }
  };
  return { list, other, tabs, windows, calls, browser, task: { id: 'task', execution: { listTabId: 10 } } };
}

await test('background preparation preserves the list tab and creates two exact-size popup windows', async () => {
  const f = workspaceFixture();
  const result = await prepareBackgroundWorkspace(f.task, f.browser);
  assert.equal(result.ok, true);
  assert.equal(f.calls.filter(c => c.api === 'windows.create').length, 2);
  assert.equal(f.calls.find(c => c.api === 'windows.create').options.focused, false);
  assert.equal(f.list.instance, 'original-list');
  assert.equal(f.list.url, 'https://www.zhipin.com/web/geek/jobs?query=ops');
  assert.equal(f.other.active, true);
  assert.equal(f.other.windowId, 1);
  assert.equal(f.list.windowId, 2);
  assert.equal(f.task.execution.backgroundWindowId, 2);
  assert.equal(f.task.execution.listWindowId, 2);
  assert.equal(f.task.execution.listTabId, 10);
  assert.equal(f.task.execution.messageWindowId, 3);
  const createCalls = f.calls.filter(c => c.api === 'windows.create');
  assert.equal(createCalls[0].options.type, 'popup', 'list workspace must use an exact-size popup window');
  assert.equal(createCalls[0].options.width, 600, 'left popup uses half of the available display');
  assert.equal(createCalls[0].options.left, 0);
  assert.equal(createCalls[1]?.options.type, 'popup', 'message workspace must use an exact-size popup window');
  assert.equal(createCalls[1]?.options.width, 600, 'right popup uses the other half of the available display');
  assert.equal(createCalls[1]?.options.left, 600);
  assert.ok(!f.calls.some(c => c.api === 'tabs.update' && c.patch?.active === true), 'background preparation must not activate a popup tab');
  const reused = await prepareBackgroundWorkspace(f.task, f.browser);
  assert.equal(reused.reused, true);
  assert.equal(f.calls.filter(c => c.api === 'windows.create').length, 2);
});

await test('background delivery creates a separate unfocused message window', () => {
  const worker = fs.readFileSync('extension/background/service-worker.js', 'utf8');
  const ensureStart = worker.indexOf('async function ensureMessageTab');
  const backgroundStart = worker.indexOf('  if (task.execution.backgroundDeliveryActive) {', ensureStart);
  const splitBranch = worker.indexOf('  } else if (task.execution.splitViewActive', backgroundStart);
  assert.ok(ensureStart >= 0, 'message-tab helper must exist');
  assert.ok(backgroundStart > ensureStart, 'background message branch must exist');
  assert.ok(splitBranch > backgroundStart, 'background branch must precede split-view branch');
  const branch = worker.slice(backgroundStart, splitBranch);
  assert.match(branch, /chrome\.windows\.create\(\{[\s\S]*url:\s*['"]https:\/\/www\.zhipin\.com\/web\/geek\/chat['"][\s\S]*type:\s*['"]popup['"][\s\S]*focused:\s*false/);
  assert.match(branch, /task\.execution\.messageWindowId\s*=\s*messageWindow\.id/);
  assert.match(branch, /chrome\.tabs\.update\(tab\.id,\s*\{\s*autoDiscardable:\s*false\s*\}\)/);
});

await test('message tabs may activate only inside the list or message background windows', async () => {
  const f = workspaceFixture();
  await prepareBackgroundWorkspace(f.task, f.browser);
  const messageWindow = { id: 3, state: 'normal', focused: false };
  const messageTab = { id: 12, windowId: messageWindow.id, url: 'https://www.zhipin.com/web/geek/chat', active: false };
  const userTab = { id: 13, windowId: 99, url: 'https://www.zhipin.com/web/geek/chat', active: false };
  f.windows.set(messageWindow.id, messageWindow);
  f.tabs.set(messageTab.id, messageTab);
  f.tabs.set(userTab.id, userTab);
  f.task.execution.messageWindowId = messageWindow.id;
  f.task.execution.messageTabId = messageTab.id;

  const allowed = [f.task.execution.backgroundWindowId, f.task.execution.messageWindowId];
  assert.deepEqual(await activateBackgroundTab(messageWindow.id, messageTab.id, f.browser, allowed), { ok: true, minimized: false, unfocused: true });
  assert.equal(messageTab.active, false, 'an unfocused workspace window must remain untouched');

  f.calls.length = 0;
  assert.equal((await activateBackgroundTab(messageWindow.id, userTab.id, f.browser, allowed)).error, 'BACKGROUND_TAB_MOVED');
  assert.equal(f.calls.length, 0, 'a tab moved to the user window must not be activated');
});

await test('minimized list windows remain usable without restoring or focusing them', async () => {
  const f = workspaceFixture(); await prepareBackgroundWorkspace(f.task, f.browser);
  f.windows.get(2).state = 'minimized'; f.calls.length = 0;
  assert.equal(await backgroundWorkspaceProblem(f.task, f.browser), null);
  assert.equal((await prepareBackgroundWorkspace(f.task, f.browser)).reused, true);
  assert.deepEqual(await activateBackgroundTab(2, 10, f.browser), { ok: true, minimized: true, unfocused: true });
  assert.ok(f.calls.some(c => c.api === 'tabs.update' && c.id === 10 && c.patch.autoDiscardable === false));
});

await test('unfocused normal workspace windows do not steal the foreground', async () => {
  const f = workspaceFixture(); await prepareBackgroundWorkspace(f.task, f.browser);
  const activeBefore = f.list.active;
  f.windows.get(2).focused = false;
  f.calls.length = 0;
  const result = await activateBackgroundTab(2, 10, f.browser);
  assert.deepEqual(result, { ok: true, minimized: false, unfocused: true });
  assert.deepEqual(f.calls, [{ api: 'tabs.update', id: 10, patch: { autoDiscardable: false } }]);
  assert.equal(f.list.active, activeBefore, 'switching to another app must not change the active tab');
});

await test('minimized or closed message windows keep delivery alive; closed windows still pause', async () => {
  const f = workspaceFixture(); await prepareBackgroundWorkspace(f.task, f.browser);
  const messageWindow = f.windows.get(3);
  const messageTab = f.tabs.get(f.task.execution.messageTabId);
  f.windows.set(messageWindow.id, messageWindow);
  f.tabs.set(messageTab.id, messageTab);
  f.task.execution.messageWindowId = messageWindow.id;
  f.task.execution.messageTabId = messageTab.id;

  messageWindow.state = 'minimized';
  f.calls.length = 0;
  assert.equal(await backgroundWorkspaceProblem(f.task, f.browser), null);
  assert.deepEqual(await activateBackgroundTab(messageWindow.id, messageTab.id, f.browser, [2, 3]), { ok: true, minimized: true, unfocused: true });
  assert.ok(f.calls.some(c => c.api === 'tabs.update' && c.id === messageTab.id && c.patch.autoDiscardable === false));

  messageWindow.state = 'normal';
  f.windows.delete(messageWindow.id);
  assert.equal((await backgroundWorkspaceProblem(f.task, f.browser)).error, 'BACKGROUND_WINDOW_CLOSED');
});

await test('background navigation does not restore a minimized window or activate its tab', async () => {
  const f = workspaceFixture(); await prepareBackgroundWorkspace(f.task, f.browser);
  const worker = { id: 40, windowId: 3, url: 'https://www.zhipin.com/job_detail/old.html', active: true };
  f.tabs.set(worker.id, worker);
  f.windows.get(3).state = 'minimized';
  f.calls.length = 0;
  const result = await navigateBackgroundTab(worker.id, 'https://www.zhipin.com/job_detail/new.html', f.browser, [2, 3]);
  assert.equal(result.ok, true);
  assert.equal(result.minimized, true);
  assert.deepEqual(f.calls, [{ api: 'tabs.update', id: 40, patch: { url: 'https://www.zhipin.com/job_detail/new.html', autoDiscardable: false } }]);
  assert.equal(f.windows.get(3).state, 'minimized');
  assert.equal(worker.active, true, 'navigation must not change the active tab flag in a minimized window');
});

await test('manually moved or closed tabs never activate a user window', async () => {
  const f = workspaceFixture(); await prepareBackgroundWorkspace(f.task, f.browser);
  f.list.windowId = 99; f.calls.length = 0;
  assert.equal((await activateBackgroundTab(2, 10, f.browser)).error, 'BACKGROUND_TAB_MOVED');
  assert.equal((await backgroundWorkspaceProblem(f.task, f.browser)).error, 'BACKGROUND_LIST_MOVED');
  f.tabs.delete(10);
  assert.equal((await prepareBackgroundWorkspace(f.task, f.browser)).error, 'LIST_TAB_NOT_FOUND');
  assert.equal(f.calls.length, 0);
});

await test('a stale saved list tab is recovered from the delivery popup', async () => {
  const f = workspaceFixture();
  await prepareBackgroundWorkspace(f.task, f.browser);
  const popupList = { id: 21, windowId: 2, url: 'https://www.zhipin.com/web/geek/jobs?query=ops', active: true };
  f.tabs.set(popupList.id, popupList);
  f.tabs.delete(f.list.id);
  f.task.execution.listTabId = f.list.id;
  f.calls.length = 0;
  assert.equal(await backgroundWorkspaceProblem(f.task, f.browser), null);
  assert.equal(f.task.execution.listTabId, popupList.id);
  const result = await prepareBackgroundWorkspace(f.task, f.browser);
  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(result.listTabId, popupList.id);
  assert.equal(f.task.execution.listTabId, popupList.id);
});

await test('a duplicate sender list never replaces the active delivery list', () => {
  const worker = fs.readFileSync('extension/background/service-worker.js', 'utf8');
  const start = worker.indexOf("case MSG.RUN_TEST_DELIVERY");
  const end = worker.indexOf("const wantId = payload?.jobId", start);
  const branch = worker.slice(start, end);
  assert.match(branch, /workspaceActive/);
  assert.match(branch, /savedListTab\.windowId === task\.execution\.backgroundWindowId/);
  assert.match(branch, /prepareBackgroundWorkspace/);
});

await test('a stale active chat tab is never adopted as the background list', async () => {
  const f = workspaceFixture();
  f.task.execution.listTabId = 99;
  f.tabs.set(99, { id: 99, windowId: 1, url: 'https://www.zhipin.com/web/geek/chat', active: true });
  const result = await prepareBackgroundWorkspace(f.task, f.browser);
  assert.equal(result.error, 'LIST_TAB_NOT_FOUND');
  assert.equal(f.task.execution.listTabId, 99);
  assert.equal(f.calls.length, 0);
});

await test('message-window creation failure restores the original list window and leaves no orphan', async () => {
  const f = workspaceFixture();
  const original = { ...f.windows.get(1) };
  const create = f.browser.windows.create;
  f.browser.windows.create = async options => {
    f.calls.push({ api: 'windows.create', options });
    throw new Error('blocked');
  };
  const result = await prepareBackgroundWorkspace(f.task, f.browser);
  assert.equal(result.error, 'BACKGROUND_WORKSPACE_FAILED');
  assert.equal(f.windows.size, 1);
  assert.deepEqual(f.windows.get(1), original);
  assert.equal(f.task.execution.backgroundDeliveryActive, false);
  f.browser.windows.create = create;
});

await test('workspace failure preserves a popup when moving the only source tab closes its window', async () => {
  const f = workspaceFixture();
  const create = f.browser.windows.create;
  let createCount = 0;
  f.browser.windows.create = async options => {
    createCount += 1;
    if (createCount === 1) {
      const result = await create(options);
      // Chromium can close a source window as soon as its only tab is moved.
      // Simulate that failure mode before the message popup is attempted.
      f.windows.delete(1);
      return result;
    }
    throw new Error('message popup blocked');
  };
  const result = await prepareBackgroundWorkspace(f.task, f.browser);
  assert.equal(result.error, 'BACKGROUND_WORKSPACE_FAILED');
  assert.equal(f.windows.has(2), true, 'the relocated list popup must remain recoverable');
  assert.equal(f.tabs.get(f.list.id).windowId, 2);
  assert.equal(f.task.execution.listTabId, f.list.id);
  assert.equal(f.task.execution.backgroundWindowId, 2);
  assert.equal(f.calls.some(c => c.api === 'windows.remove' && c.id === 2), false,
    'failed setup must not delete the only surviving list window');
});

await test('legacy same-window workspaces rebuild without deleting the list window first', async () => {
  const f = workspaceFixture();
  f.other.url = 'https://www.zhipin.com/web/geek/chat';
  f.other.pendingUrl = f.other.url;
  f.tabs.set(50, { id: 50, windowId: 1, url: 'https://example.com/user-work', active: false });
  f.task.execution = {
    listTabId: f.list.id,
    listWindowId: 1,
    backgroundWindowId: 1,
    backgroundDeliveryActive: true,
    splitViewActive: true,
    messageWindowId: 1,
    messageTabId: f.other.id
  };
  const result = await prepareBackgroundWorkspace(f.task, f.browser);
  assert.equal(result.ok, true);
  assert.equal(result.splitView, true);
  assert.equal(f.task.execution.backgroundWindowId, 2);
  assert.equal(f.task.execution.messageWindowId, 3);
  assert.ok(f.tabs.has(50), 'unrelated user tabs must survive legacy workspace rebuild');
  assert.ok(!f.tabs.has(f.other.id), 'only the legacy delivery chat tab is removed');
  assert.ok(f.windows.has(1), 'the original normal window remains when it still has user tabs');
});

await test('ambiguous duplicate list tabs are never guessed as the task source', async () => {
  const f = workspaceFixture();
  await prepareBackgroundWorkspace(f.task, f.browser);
  f.tabs.set(21, { id: 21, windowId: 2, url: f.list.url, active: false });
  f.tabs.set(22, { id: 22, windowId: 2, url: f.list.url, active: false });
  f.tabs.delete(f.list.id);
  f.task.execution.listTabId = 10;
  assert.equal((await backgroundWorkspaceProblem(f.task, f.browser)).error, 'BACKGROUND_LIST_MOVED');
  assert.equal(f.task.execution.listTabId, 10);
});

await test('page clock loads in both initial content injection and reinjection, and cancellation uses it', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  const isolated = manifest.content_scripts.find(s => s.world !== 'MAIN');
  assert.ok(isolated.js.indexOf('shared/page-clock.js') < isolated.js.indexOf('content/content-main.js'));
  const worker = fs.readFileSync('extension/background/service-worker.js', 'utf8');
  const content = fs.readFileSync('extension/content/content-main.js', 'utf8');
  assert.ok(worker.includes('"shared/page-clock.js"'));
  assert.ok(content.includes('yieldTurn: () => pageClock.sleep(0, opId)'));
  assert.ok(content.includes('pageClock.cancel(opId)'));
});
console.log(`Background delivery: ${passed} tests passed.`);
