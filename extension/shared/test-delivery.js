// Pure helpers for "投递一份": pick next unfinished pass job.
// Used by background RUN_TEST_DELIVERY (and unit tests).
import { collectDoneJobIds } from './task-model.js';
export { collectDoneJobIds } from './task-model.js';

/**
 * @param {object} opts
 * @param {Array} opts.results
 * @param {Array} [opts.items]
 * @param {Array} [opts.queue]
 * @param {string|null} [opts.wantId]
 * @param {Iterable<string>|Set<string>|null} [opts.selectedIds]
 * @param {Iterable<string>|Set<string>|null} [opts.extraDoneIds]
 */
export function pickNextTestDeliveryJob({
  results = [],
  items = [],
  queue = [],
  wantId = null,
  selectedIds = null,
  extraDoneIds = null
} = {}) {
  const passRows = (results || []).filter((r) => r?.decision === "pass" && r?.job?.jobId);
  if (!passRows.length) {
    return {
      ok: false,
      error: "NO_PASS",
      message: "预览结果中没有通过筛选的岗位，无法投递一份"
    };
  }

  const doneIds = collectDoneJobIds(items, queue, extraDoneIds);
  const pendingRows = passRows.filter((r) => !doneIds.has(String(r.job.jobId)));
  if (!pendingRows.length) {
    return {
      ok: false,
      error: "ALL_TESTED",
      message: "当前通过岗位都已投过了。请重新扫描预览，或先勾选尚未投过的岗位"
    };
  }

  let pick = null;
  const want = wantId != null && wantId !== "" ? String(wantId) : null;
  if (want && !doneIds.has(want)) {
    pick = pendingRows.find((r) => String(r.job?.jobId) === want) || null;
  }
  if (!pick && selectedIds) {
    const sel = selectedIds instanceof Set ? selectedIds : new Set([...selectedIds].map(String));
    pick = pendingRows.find((r) => sel.has(String(r.job.jobId))) || null;
  }
  if (!pick) {
    pick = pendingRows.find((r) => r.selected) || pendingRows[0];
  }

  return {
    ok: true,
    pick,
    onlyId: String(pick.job.jobId),
    remain: Math.max(0, pendingRows.length - 1),
    pendingCount: pendingRows.length,
    doneCount: doneIds.size
  };
}
