function logTimestamp(entry) {
  const value = Number(entry?.ts || 0);
  return Number.isFinite(value) ? value : 0;
}

function dedupeLogs(entries = []) {
  const seen = new Set();
  return (entries || []).filter((entry, index) => {
    const key = entry?.id
      ? `id:${entry.id}`
      : `fallback:${logTimestamp(entry)}:${entry?.level || ''}:${entry?.message || ''}:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sortLogsNewestFirst(entries = []) {
  return dedupeLogs(entries)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => logTimestamp(b.entry) - logTimestamp(a.entry) || a.index - b.index)
    .map(({ entry }) => entry);
}

export function sortLogsOldestFirst(entries = []) {
  return sortLogsNewestFirst(entries).reverse();
}

export function mergeRuntimeLog(entries = [], incoming = null, limit = 1000) {
  return sortLogsNewestFirst([incoming, ...(entries || [])].filter(Boolean)).slice(0, limit);
}

export function formatLogTimestamp(value, { includeDate = true } = {}) {
  const date = new Date(Number(value || Date.now()));
  const pad = (part) => String(part).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  if (!includeDate) return time;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}
