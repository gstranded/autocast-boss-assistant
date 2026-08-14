import {
  DEFAULT_FILTERS,
  DEFAULT_LISTS,
  DEFAULT_MESSAGE_TEMPLATE,
  DEFAULT_SETTINGS,
  STORAGE_KEYS
} from './constants.js';
import { deepClone, todayKey, uid } from './text-utils.js';
import { countResumeImages, normalizeResumes } from './resume-images.js';

async function get(keys) {
  return chrome.storage.local.get(keys);
}

async function set(obj) {
  return chrome.storage.local.set(obj);
}

export async function ensureDefaults() {
  const data = await get(Object.values(STORAGE_KEYS));
  const patch = {};
  if (!data[STORAGE_KEYS.SETTINGS]) patch[STORAGE_KEYS.SETTINGS] = deepClone(DEFAULT_SETTINGS);
  if (!data[STORAGE_KEYS.FILTERS]) patch[STORAGE_KEYS.FILTERS] = deepClone(DEFAULT_FILTERS);
  if (!data[STORAGE_KEYS.MESSAGE_TEMPLATE]) {
    patch[STORAGE_KEYS.MESSAGE_TEMPLATE] = deepClone(DEFAULT_MESSAGE_TEMPLATE);
  }
  if (!data[STORAGE_KEYS.RESUMES]) {
    patch[STORAGE_KEYS.RESUMES] = {
      profiles: [
        {
          id: 'default',
          name: '默认简历',
          images: []
        }
      ],
      defaultProfileId: 'default'
    };
  }
  if (!data[STORAGE_KEYS.BINDINGS]) patch[STORAGE_KEYS.BINDINGS] = { rules: [] };
  if (!data[STORAGE_KEYS.LISTS]) patch[STORAGE_KEYS.LISTS] = deepClone(DEFAULT_LISTS);
  if (!data[STORAGE_KEYS.HISTORY]) patch[STORAGE_KEYS.HISTORY] = [];
  if (!data[STORAGE_KEYS.IDEMPOTENCY]) patch[STORAGE_KEYS.IDEMPOTENCY] = {};
  if (!data[STORAGE_KEYS.TASK]) patch[STORAGE_KEYS.TASK] = null;
  if (!data[STORAGE_KEYS.LOGS]) patch[STORAGE_KEYS.LOGS] = [];
  if (!data[STORAGE_KEYS.DAILY_STATS]) patch[STORAGE_KEYS.DAILY_STATS] = {};
  if (Object.keys(patch).length) await set(patch);
  return get(Object.values(STORAGE_KEYS));
}

export async function getAllConfig() {
  await ensureDefaults();
  const data = await get(Object.values(STORAGE_KEYS));
  const settings = { ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  if (settings.resumeSendTiming === 'on_request') {
    settings.resumeSendTiming = 'after_text';
    await set({ [STORAGE_KEYS.SETTINGS]: settings });
  }
  const resumes = normalizeResumes(data[STORAGE_KEYS.RESUMES]);
  if (countResumeImages(resumes) < countResumeImages(data[STORAGE_KEYS.RESUMES])) {
    await set({ [STORAGE_KEYS.RESUMES]: resumes });
  }
  return {
    settings,
    filters: data[STORAGE_KEYS.FILTERS],
    messageTemplate: data[STORAGE_KEYS.MESSAGE_TEMPLATE],
    resumes,
    bindings: data[STORAGE_KEYS.BINDINGS],
    lists: data[STORAGE_KEYS.LISTS],
    history: data[STORAGE_KEYS.HISTORY] || [],
    idempotency: data[STORAGE_KEYS.IDEMPOTENCY] || {},
    task: data[STORAGE_KEYS.TASK],
    logs: data[STORAGE_KEYS.LOGS] || [],
    dailyStats: data[STORAGE_KEYS.DAILY_STATS] || {}
  };
}

export async function saveSettings(settings) {
  await set({ [STORAGE_KEYS.SETTINGS]: settings });
}

export async function saveFilters(filters) {
  await set({ [STORAGE_KEYS.FILTERS]: filters });
}

export async function saveMessageTemplate(template) {
  await set({ [STORAGE_KEYS.MESSAGE_TEMPLATE]: template });
}

export async function saveResumes(resumes) {
  try {
    await set({ [STORAGE_KEYS.RESUMES]: normalizeResumes(resumes) });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/QUOTA|quota|exceed/i.test(msg)) {
      throw new Error('存储空间不足，无法保存简历图片（' + msg + '）。请减少图片或安装含 unlimitedStorage 的版本');
    }
    throw err;
  }
}

export async function saveBindings(bindings) {
  await set({ [STORAGE_KEYS.BINDINGS]: bindings });
}

export async function saveLists(lists) {
  await set({ [STORAGE_KEYS.LISTS]: lists });
}

export async function saveTask(task) {
  await set({ [STORAGE_KEYS.TASK]: task });
}

export async function appendLog(entry) {
  const { [STORAGE_KEYS.LOGS]: logs = [] } = await get(STORAGE_KEYS.LOGS);
  const next = [
    {
      id: uid('log'),
      ts: Date.now(),
      ...entry
    },
    ...logs
  ].slice(0, 1000);
  await set({ [STORAGE_KEYS.LOGS]: next });
  return next[0];
}

export async function clearLogs() {
  await set({ [STORAGE_KEYS.LOGS]: [] });
}

export async function clearHistory() {
  await set({ [STORAGE_KEYS.HISTORY]: [] });
}

export async function appendHistory(record) {
  const { [STORAGE_KEYS.HISTORY]: history = [] } = await get(STORAGE_KEYS.HISTORY);
  const next = [{ id: uid('hist'), ts: Date.now(), ...record }, ...history].slice(0, 5000);
  await set({ [STORAGE_KEYS.HISTORY]: next });
  return next[0];
}

export async function getHistory() {
  const { [STORAGE_KEYS.HISTORY]: history = [] } = await get(STORAGE_KEYS.HISTORY);
  return history;
}

export async function markIdempotent(key, meta = {}) {
  const { [STORAGE_KEYS.IDEMPOTENCY]: map = {} } = await get(STORAGE_KEYS.IDEMPOTENCY);
  map[key] = { ts: Date.now(), ...meta };
  // 控制体积
  const keys = Object.keys(map);
  if (keys.length > 8000) {
    keys
      .sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0))
      .slice(0, keys.length - 6000)
      .forEach((k) => delete map[k]);
  }
  await set({ [STORAGE_KEYS.IDEMPOTENCY]: map });
}

export async function hasIdempotent(key) {
  const { [STORAGE_KEYS.IDEMPOTENCY]: map = {} } = await get(STORAGE_KEYS.IDEMPOTENCY);
  return Boolean(map[key]);
}

export async function getIdempotencyMap() {
  const { [STORAGE_KEYS.IDEMPOTENCY]: map = {} } = await get(STORAGE_KEYS.IDEMPOTENCY);
  return map;
}

export async function bumpDailyStat(field, amount = 1, companyKey = '') {
  const day = todayKey();
  const { [STORAGE_KEYS.DAILY_STATS]: stats = {} } = await get(STORAGE_KEYS.DAILY_STATS);
  const cur = stats[day] || { communicate: 0, success: 0, skip: 0, fail: 0, byCompany: {} };
  cur[field] = (cur[field] || 0) + amount;
  if (companyKey) {
    cur.byCompany[companyKey] = (cur.byCompany[companyKey] || 0) + amount;
  }
  stats[day] = cur;
  // keep 60 days
  const keys = Object.keys(stats).sort();
  if (keys.length > 60) keys.slice(0, keys.length - 60).forEach((k) => delete stats[k]);
  await set({ [STORAGE_KEYS.DAILY_STATS]: stats });
  return cur;
}

export async function getTodayStats() {
  const day = todayKey();
  const { [STORAGE_KEYS.DAILY_STATS]: stats = {} } = await get(STORAGE_KEYS.DAILY_STATS);
  return stats[day] || { communicate: 0, success: 0, skip: 0, fail: 0, byCompany: {} };
}

export const IMPORT_CONFIG_KEYS = {
  settings: STORAGE_KEYS.SETTINGS,
  filters: STORAGE_KEYS.FILTERS,
  messageTemplate: STORAGE_KEYS.MESSAGE_TEMPLATE,
  resumes: STORAGE_KEYS.RESUMES,
  bindings: STORAGE_KEYS.BINDINGS,
  lists: STORAGE_KEYS.LISTS,
  history: STORAGE_KEYS.HISTORY
};

export function buildExportPayload(all = {}, now = new Date()) {
  return {
    exportedAt: now.toISOString(),
    version: 1,
    ...all,
    logs: (all.logs || []).slice(0, 100)
  };
}

export function importConfigPatch(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('无效配置文件');
  const put = {};
  for (const [key, storageKey] of Object.entries(IMPORT_CONFIG_KEYS)) {
    if (payload[key] != null) put[storageKey] = payload[key];
  }
  return put;
}

export async function exportAll() {
  return buildExportPayload(await getAllConfig());
}

export async function importAll(payload) {
  const put = importConfigPatch(payload);
  await set(put);
  return getAllConfig();
}
