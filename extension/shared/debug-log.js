const DEBUG_LOG_KEY = 'bht_debug_logs_session';
const MAX_ENTRIES = 5000;
const MAX_SERIALIZED_BYTES = 5 * 1024 * 1024;
let writeChain = Promise.resolve();
let pendingEntries = [];
let flushPromise = null;

function cleanString(value, maxLength = 8000) {
  const text = String(value ?? '');
  if (/^data:[^,]+;base64,/i.test(text)) return `[data-url omitted, ${text.length} chars]`;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…[truncated ${text.length - maxLength}]` : text;
}

export function sanitizeDebugValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return cleanString(value);
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object') return cleanString(value);
  if (depth >= 8) return '[max-depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const rows = value.slice(0, 120).map((item) => sanitizeDebugValue(item, depth + 1, seen));
    if (value.length > rows.length) rows.push(`[${value.length - rows.length} more items]`);
    return rows;
  }

  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 160)) {
    if (/dataUrl|base64|attachmentData|imageData/i.test(key)) {
      out[key] = typeof item === 'string' ? `[binary omitted, ${item.length} chars]` : '[binary omitted]';
      continue;
    }
    out[key] = sanitizeDebugValue(item, depth + 1, seen);
  }
  return out;
}

function trimToBudget(entries) {
  let rows = entries.slice(-MAX_ENTRIES);
  while (rows.length > 100) {
    const bytes = new Blob([JSON.stringify(rows)]).size;
    if (bytes <= MAX_SERIALIZED_BYTES) break;
    rows = rows.slice(Math.max(1, Math.floor(rows.length * 0.1)));
  }
  return rows;
}

function ensureFlush() {
  if (flushPromise) return flushPromise;
  flushPromise = new Promise((resolve) => setTimeout(resolve, 120)).then(async () => {
    const batch = pendingEntries.splice(0);
    writeChain = writeChain.then(async () => {
      if (!batch.length || !globalThis.chrome?.storage?.session) return null;
      const bag = await chrome.storage.session.get(DEBUG_LOG_KEY);
      const current = Array.isArray(bag?.[DEBUG_LOG_KEY]) ? bag[DEBUG_LOG_KEY] : [];
      const next = trimToBudget([...current, ...batch]);
      await chrome.storage.session.set({ [DEBUG_LOG_KEY]: next });
      return next[next.length - 1] || null;
    }).catch(() => null);
    const result = await writeChain;
    flushPromise = null;
    if (pendingEntries.length) await ensureFlush();
    return result;
  });
  return flushPromise;
}

export function appendSessionDebugLog(entry) {
  pendingEntries.push(sanitizeDebugValue(entry));
  return ensureFlush().then(() => entry).catch(() => null);
}

export async function getSessionDebugLogs() {
  if (pendingEntries.length) await ensureFlush();
  await writeChain;
  if (!globalThis.chrome?.storage?.session) return [];
  const bag = await chrome.storage.session.get(DEBUG_LOG_KEY);
  return Array.isArray(bag?.[DEBUG_LOG_KEY]) ? bag[DEBUG_LOG_KEY] : [];
}
