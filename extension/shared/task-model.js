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
  const queue = [];
  const rows = (results || []).filter(
    (row) => row?.decision === 'pass' && (!selectedOnly || row.selected !== false)
  );

  for (const row of rows) {
    const job = row.job || {};
    const id = String(job.jobId || '');
    const title = normalizeMatchText(job.title || '');
    if ((!title && !id) || queue.some((item) => jobsShareMergeIdentity(item, job))) continue;
    queue.push({
      index: queue.length,
      jobId: job.jobId,
      title: job.title,
      company: job.company,
      location: job.location || '',
      lid: job.lid || '',
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
  const fallback = fallbackJobMergeKey(job);
  const securityId = normalizeMatchText(job?.securityId || '');
  const lid = normalizeMatchText(job?.lid || '');
  return `${fallback}|sid:${securityId}|lid:${lid}`;
}

function fallbackJobMergeKey(job = {}, includeLocation = true) {
  const company = normalizeMatchText(job?.company || '');
  const title = normalizeMatchText(job?.title || '');
  const location = includeLocation ? normalizeMatchText(job?.location || job?.city || '') : '';
  return `tc:${company}|${title}${includeLocation ? `|${location}` : ''}`;
}

function isSyntheticJobId(jobId) {
  const id = String(jobId || '').trim();
  return !id || id.startsWith('name_') || id.startsWith('dom_');
}

function hasJobEvidence(job = {}) {
  return Boolean(
    normalizeMatchText(job?.securityId || '') ||
    normalizeMatchText(job?.lid || '') ||
    String(job?.href || '').trim()
  );
}

function hasSharedJobEvidence(left = {}, right = {}) {
  const leftSecurityId = normalizeMatchText(left?.securityId || '');
  const rightSecurityId = normalizeMatchText(right?.securityId || '');
  const leftLid = normalizeMatchText(left?.lid || '');
  const rightLid = normalizeMatchText(right?.lid || '');
  const leftHref = String(left?.href || '').trim();
  const rightHref = String(right?.href || '').trim();
  return Boolean(
    (leftSecurityId && rightSecurityId && leftSecurityId === rightSecurityId) ||
    (leftLid && rightLid && leftLid === rightLid) ||
    (leftHref && rightHref && leftHref === rightHref)
  );
}

function hasConflictingJobEvidence(left = {}, right = {}) {
  const leftSecurityId = normalizeMatchText(left?.securityId || '');
  const rightSecurityId = normalizeMatchText(right?.securityId || '');
  const leftLid = normalizeMatchText(left?.lid || '');
  const rightLid = normalizeMatchText(right?.lid || '');
  return Boolean(
    (leftSecurityId && rightSecurityId && leftSecurityId !== rightSecurityId) ||
    (leftLid && rightLid && leftLid !== rightLid)
  );
}

// Synthetic ids can change when a virtualized card exposes more metadata on a
// later scan. Match the fallback identity when evidence is incomplete, while
// keeping two fully identified jobs with different evidence separate.
export function jobsShareMergeIdentity(left = {}, right = {}) {
  const leftId = String(left?.jobId || '').trim();
  const rightId = String(right?.jobId || '').trim();
  const leftRealId = !isSyntheticJobId(leftId);
  const rightRealId = !isSyntheticJobId(rightId);
  if (leftRealId && rightRealId) return leftId === rightId;

  const leftBase = fallbackJobMergeKey(left, false);
  const rightBase = fallbackJobMergeKey(right, false);
  if (leftBase !== rightBase) return false;

  const leftLocation = normalizeMatchText(left?.location || left?.city || '');
  const rightLocation = normalizeMatchText(right?.location || right?.city || '');
  const sharedEvidence = hasSharedJobEvidence(left, right);
  if (hasConflictingJobEvidence(left, right)) return false;
  const leftStrong = {
    securityId: normalizeMatchText(left?.securityId || ''),
    lid: normalizeMatchText(left?.lid || ''),
    href: String(left?.href || '').trim()
  };
  const rightStrong = {
    securityId: normalizeMatchText(right?.securityId || ''),
    lid: normalizeMatchText(right?.lid || ''),
    href: String(right?.href || '').trim()
  };
  if (leftStrong.securityId && rightStrong.securityId && leftStrong.securityId !== rightStrong.securityId) return false;
  if (leftStrong.lid && rightStrong.lid && leftStrong.lid !== rightStrong.lid) return false;
  if (leftStrong.href && rightStrong.href && leftStrong.href !== rightStrong.href) return false;

  if (leftRealId !== rightRealId) {
    // A real id can replace a synthetic id only when the two records share a
    // strong field; matching display labels alone must not merge postings.
    return sharedEvidence;
  }

  if (leftLocation && rightLocation && leftLocation !== rightLocation) {
    // A matching strong identity can survive a location label update; without
    // it, two same-title jobs in different cities must remain distinct.
    return sharedEvidence;
  }

  // If both cards expose an identity value but neither value agrees, keep
  // them separate. A card with no identity evidence may still be upgraded to
  // a real id later when its labels and location match.
  if (hasJobEvidence(left) && hasJobEvidence(right) && !sharedEvidence) return false;

  return true;
}

export function mergeTaskResults(previous = [], incoming = []) {
  const results = [];
  let duplicates = 0;
  for (const row of [...(previous || []), ...(incoming || [])]) {
    const duplicateIndex = results.findIndex((existing) =>
      jobsShareMergeIdentity(existing?.job || existing || {}, row?.job || row || {})
    );
    if (duplicateIndex >= 0) {
      duplicates += 1;
      const existing = results[duplicateIndex];
      if (existing?.job || row?.job) {
        results[duplicateIndex] = {
          ...existing,
          job: {
            ...(existing.job || {}),
            ...(row.job || {}),
            jobId: !isSyntheticJobId(existing.job?.jobId)
              ? existing.job.jobId
              : row.job?.jobId || existing.job?.jobId || ''
          }
        };
      }
      continue;
    }
    results.push(row);
  }
  return { results, added: Math.max(0, results.length - (previous || []).length), duplicates };
}

export function rebuildDeliveryQueue(results = [], previousQueue = [], doneIds = []) {
  const done = new Set((doneIds || []).map(String));
  return buildDeliveryQueue(results, { selectedOnly: true }).map((item, index) => {
    const old = (previousQueue || []).find((candidate) => jobsShareMergeIdentity(candidate, item));
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
