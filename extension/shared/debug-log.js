const DEBUG_LOG_KEY = 'bht_debug_logs_session';
const MAX_ENTRIES = 5000;
const MAX_SERIALIZED_BYTES = 3 * 1024 * 1024;
const FLUSH_INTERVAL_MS = 600;
const MAX_PENDING_ENTRIES = 20000;
let writeChain = Promise.resolve();
let pendingEntries = [];
let flushScheduled = false;

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
    if (/^(jobs|results)$/i.test(key) && Array.isArray(item)) {
      out[key] = `[${item.length} items omitted]`;
      continue;
    }
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
    // 超过预算优先丢最旧 40%，保证每次落盘成本可控（3MB 以内）。
    rows = rows.slice(Math.max(1, Math.floor(rows.length * 0.6)));
  }
  return rows;
}

async function writeBatch(batch) {
  if (!batch.length || !globalThis.chrome?.storage?.session) return null;
  const bag = await chrome.storage.session.get(DEBUG_LOG_KEY);
  const current = Array.isArray(bag?.[DEBUG_LOG_KEY]) ? bag[DEBUG_LOG_KEY] : [];
  const next = trimToBudget([...current, ...batch]);
  await chrome.storage.session.set({ [DEBUG_LOG_KEY]: next });
  return next[next.length - 1] || null;
}

function scheduleFlush() {
  if (flushScheduled || !pendingEntries.length) return;
  flushScheduled = true;
  setTimeout(async () => {
    flushScheduled = false;
    const batch = pendingEntries.splice(0);
    if (batch.length) {
      // 统一串行写，保证顺序；但调用方绝不等待这条链——日志写入不得阻塞任务主流程。
      writeChain = writeChain.then(() => writeBatch(batch)).catch(() => null);
    }
    // 极端高频时丢弃最旧一半，防止内存无界增长
    if (pendingEntries.length > MAX_PENDING_ENTRIES) {
      pendingEntries.splice(0, pendingEntries.length - Math.floor(MAX_PENDING_ENTRIES / 2));
    }
  }, FLUSH_INTERVAL_MS);
}

// 立即入队并返回：日志落盘在后台批量完成，任何 await 都不会等待 storage。
export function appendSessionDebugLog(entry) {
  pendingEntries.push(sanitizeDebugValue(entry));
  scheduleFlush();
  return Promise.resolve(entry);
}

export async function getSessionDebugLogs() {
  // 导出一致性：等待已排队写入完成；若有新进条目，再同步批量落盘一次。
  await writeChain;
  if (pendingEntries.length) {
    const batch = pendingEntries.splice(0);
    writeChain = writeChain.then(() => writeBatch(batch)).catch(() => null);
    await writeChain;
  }
  if (!globalThis.chrome?.storage?.session) return [];
  const bag = await chrome.storage.session.get(DEBUG_LOG_KEY);
  return Array.isArray(bag?.[DEBUG_LOG_KEY]) ? bag[DEBUG_LOG_KEY] : [];
}
