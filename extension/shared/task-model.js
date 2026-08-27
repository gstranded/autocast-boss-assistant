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

export function shouldAcceptTaskSnapshot(current, incoming) {
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
    const id = String(job.jobId || '');
    const title = normalizeMatchText(job.title || '');
    const company = normalizeMatchText(job.company || '');
    const key = id && !id.startsWith('name_') && !id.startsWith('dom_')
      ? `id:${id}`
      : `tc:${company}|${title}`;
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
