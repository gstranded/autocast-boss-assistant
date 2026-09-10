import { normalizeMatchText } from './text-utils.js';

const DONE_ITEM_STATES = Object.freeze(['COMPLETED', 'SKIPPED', 'FAILED']);
const DONE_QUEUE_STATES = Object.freeze(['done', 'skipped', 'failed']);

export function collectDoneJobIds(items = [], queue = [], extraDoneIds = null) {
  const done = new Set();
  for (const item of items || []) {
    if (DONE_ITEM_STATES.includes(String(item?.state || '')) && item?.jobId) {
      done.add(String(item.jobId));
    }
  }
  for (const entry of queue || []) {
    if (DONE_QUEUE_STATES.includes(String(entry?.status || '')) && entry?.jobId) {
      done.add(String(entry.jobId));
    }
  }
  for (const id of extraDoneIds || []) {
    if (id != null && id !== '') done.add(String(id));
  }
  return done;
}

export function countPassJobs(task) {
  return (task?.results || []).filter((row) => row?.decision === 'pass' && row?.job?.jobId).length;
}

export function countPendingPassJobs(task) {
  const done = collectDoneJobIds(task?.items, task?.queue, task?.testedJobIds);
  return (task?.results || []).filter(
    (row) => row?.decision === 'pass' && row?.job?.jobId && !done.has(String(row.job.jobId))
  ).length;
}

export function countSuccessfulDeliveries(task) {
  return Math.max(0, Number(task?.counters?.success || 0));
}

export function targetDeliveryRemaining(task) {
  const target = Math.max(0, Number(task?.targetCount || 0));
  if (!target) return 0;
  return Math.max(0, target - countSuccessfulDeliveries(task));
}

export function isTargetDeliveryReached(task) {
  return Boolean(task?.targetMode) && targetDeliveryRemaining(task) === 0;
}

export function taskCounterSnapshot(task) {
  const counters = task?.counters || {};
  return {
    success: Number(counters.success || 0),
    skipped: Number(counters.skipped || 0),
    failed: Number(counters.failed || 0),
    processed: Number(counters.processed || 0)
  };
}

const STATUS_PRIORITY = Object.freeze({
  idle: 0,
  previewing: 1,
  awaiting_confirm: 2,
  running: 3,
  paused: 4,
  failed: 5,
  completed: 6,
  stopped: 7
});

export function shouldAcceptTaskSnapshot(current, incoming, { authoritative = false } = {}) {
  if (authoritative) return true;
  if (!current) return true;
  if (!incoming) return false;
  if (current.id !== incoming.id) {
    return Number(incoming.createdAt || 0) >= Number(current.createdAt || 0);
  }
  const currentRevision = Number(current.revision || 0);
  const incomingRevision = Number(incoming.revision || 0);
  if (incomingRevision !== currentRevision) return incomingRevision > currentRevision;
  const currentUpdatedAt = Number(current.updatedAt || 0);
  const incomingUpdatedAt = Number(incoming.updatedAt || 0);
  if (incomingUpdatedAt !== currentUpdatedAt) return incomingUpdatedAt > currentUpdatedAt;
  return (STATUS_PRIORITY[incoming.status] || 0) >= (STATUS_PRIORITY[current.status] || 0);
}

export function buildDeliveryQueue(results = [], { selectedOnly = true } = {}) {
  const seen = new Set();
  const queue = [];
  const rows = (results || []).filter(
    (row) => row?.decision === 'pass' && (!selectedOnly || row.selected !== false)
  );

  for (const row of rows) {
    const job = row.job || {};
    const key = jobMergeKey(job);
    const id = String(job.jobId || '');
    const title = normalizeMatchText(job.title || '');
    const company = normalizeMatchText(job.company || '');
    if (seen.has(key) || (!title && !id)) continue;
    seen.add(key);
    queue.push({
      index: queue.length,
      jobId: job.jobId,
      title: job.title,
      company: job.company,
      href: job.href || '',
      securityId: job.securityId || '',
      status: 'pending'
    });
  }
  return queue;
}

export function jobMergeKey(job = {}) {
  const id = String(job?.jobId || '').trim();
  if (id && !id.startsWith('name_') && !id.startsWith('dom_')) return `id:${id}`;
  const company = normalizeMatchText(job?.company || '');
  const title = normalizeMatchText(job?.title || '');
  return `tc:${company}|${title}`;
}

export function mergeTaskResults(previous = [], incoming = []) {
  const seen = new Set();
  const results = [];
  let duplicates = 0;
  for (const row of [...(previous || []), ...(incoming || [])]) {
    const key = jobMergeKey(row?.job || row || {});
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    results.push(row);
  }
  return { results, added: Math.max(0, results.length - (previous || []).length), duplicates };
}

export function rebuildDeliveryQueue(results = [], previousQueue = [], doneIds = []) {
  const done = new Set((doneIds || []).map(String));
  const previous = new Map((previousQueue || []).map((item) => [jobMergeKey(item), item]));
  return buildDeliveryQueue(results, { selectedOnly: true }).map((item, index) => {
    const old = previous.get(jobMergeKey(item));
    const status = old?.status && ['done', 'skipped', 'failed'].includes(old.status)
      ? old.status
      : done.has(String(item.jobId || '')) ? 'done' : 'pending';
    return {
      ...item,
      index,
      status,
      ...(old?.outcome ? { outcome: old.outcome } : {}),
      ...(status === 'pending' ? {} : { finishedAt: old?.finishedAt || Date.now() })
    };
  });
}
