import { STORAGE_KEYS } from '../shared/constants.js';
import {
  canRemindUpdate,
  normalizeUpdateState,
  parseUpdateFeed,
  shouldCheckForUpdate,
  UPDATE_FEED_URL
} from '../shared/update-policy.js';

export const UPDATE_CHECK_ALARM = 'bht_update_check';

export function createUpdateChecker({
  storage,
  currentVersion,
  fetchFeed = (...args) => fetch(...args),
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let chain = Promise.resolve();
  let checking = null;
  const enqueue = (work) => {
    const result = chain.then(work);
    chain = result.catch(() => {});
    return result;
  };
  const read = async () => {
    const bag = await storage.get(STORAGE_KEYS.UPDATE);
    return normalizeUpdateState(bag?.[STORAGE_KEYS.UPDATE]);
  };
  const write = async (state) => storage.set({ [STORAGE_KEYS.UPDATE]: state });

  function check({ force = false } = {}) {
    if (checking) return checking;
    checking = enqueue(async () => {
      let state = await read();
      if (!force && !shouldCheckForUpdate(state, now())) return { ok: true, cached: true, state };
      state.lastAttemptAt = now();
      await write(state); // Throttle errors and worker restarts as well as successes.
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimer(() => {
            controller.abort();
            reject(new Error('检查更新超时'));
          }, 12000);
        });
        const release = await Promise.race([
          (async () => {
            const response = await fetchFeed(UPDATE_FEED_URL, { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return parseUpdateFeed(await response.text());
          })(),
          timeout
        ]);
        state = { ...state, ...release, lastCheckedAt: now() };
        await write(state);
        return { ok: true, state };
      } catch (error) {
        // Keep a previously discovered release usable when the network fails.
        return { ok: false, state, message: String(error?.message || error) };
      } finally {
        clearTimer(timer);
      }
    }).finally(() => { checking = null; });
    return checking;
  }

  function claimReminder(version) {
    return enqueue(async () => {
      const state = await read();
      if (version !== state.latestVersion || !canRemindUpdate(state, currentVersion)) {
        return { ok: true, claimed: false, state };
      }
      if (state.pendingReminder?.version === version && state.pendingReminder.expiresAt > now()) {
        return { ok: true, claimed: false, state };
      }
      const claimId = crypto.randomUUID();
      state.pendingReminder = { id: claimId, version, expiresAt: now() + 30000 };
      await write(state);
      return { ok: true, claimed: true, claimId, state };
    });
  }

  function confirmReminder(claimId) {
    return enqueue(async () => {
      const state = await read();
      const pending = state.pendingReminder;
      if (!pending || pending.id !== claimId || pending.expiresAt <= now() ||
          pending.version !== state.latestVersion || !canRemindUpdate(state, currentVersion)) {
        return { ok: true, confirmed: false, state };
      }
      state.notifiedVersion = pending.version;
      state.pendingReminder = null;
      await write(state);
      return { ok: true, confirmed: true, state };
    });
  }

  function cancelReminder(claimId) {
    return enqueue(async () => {
      const state = await read();
      if (!state.pendingReminder || state.pendingReminder.id !== claimId) {
        return { ok: true, cancelled: false, state };
      }
      state.pendingReminder = null;
      await write(state);
      return { ok: true, cancelled: true, state };
    });
  }

  return { check, claimReminder, confirmReminder, cancelReminder };
}

export function startUpdateChecks(browser, checker) {
  const initialize = async () => {
    if (browser.alarms) {
      const alarm = await browser.alarms.get(UPDATE_CHECK_ALARM);
      if (!alarm) await browser.alarms.create(UPDATE_CHECK_ALARM, { delayInMinutes: 360, periodInMinutes: 360 });
    }
    await checker.check();
  };
  browser.runtime.onStartup?.addListener(() => { initialize().catch(() => {}); });
  browser.runtime.onInstalled?.addListener(() => { initialize().catch(() => {}); });
  browser.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm?.name === UPDATE_CHECK_ALARM) checker.check().catch(() => {});
  });
  initialize().catch(() => {});
}
