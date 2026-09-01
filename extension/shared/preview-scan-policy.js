export const PREVIEW_SCAN_STOP = Object.freeze({
  SCANNING: 'scanning',
  REACHED_END: 'reached_end',
  TIMEOUT: 'timeout',
  BATCH_ERROR: 'batch_error'
});

export function normalizePreviewScanTerminalState({
  reachedEnd = false,
  timedOut = false,
  deadlineAt = 0,
  now = Date.now()
} = {}) {
  const confirmedEnd = reachedEnd === true;
  const deadlineExpired = !confirmedEnd && Number(deadlineAt) > 0 && Number(now) >= Number(deadlineAt);
  const confirmedTimeout = timedOut === true || deadlineExpired;
  return {
    reachedEnd: confirmedEnd && !confirmedTimeout,
    timedOut: confirmedTimeout
  };
}

export function resolvePreviewScanStop({
  reachedEnd = false,
  timedOut = false,
  deadlineAt = 0,
  now = Date.now(),
  batchError = '',
  maxElapsedMs = 60000
} = {}) {
  const terminal = normalizePreviewScanTerminalState({ reachedEnd, timedOut, deadlineAt, now });
  if (terminal.timedOut) {
    return {
      done: true,
      reason: PREVIEW_SCAN_STOP.TIMEOUT,
      // Keep the exact deadline in scanMeta/debug logs; the panel only needs
      // to communicate the next user-visible phase.
      message: '正在筛选已加载岗位'
    };
  }

  if (terminal.reachedEnd) {
    return {
      done: true,
      reason: PREVIEW_SCAN_STOP.REACHED_END,
      message: '正在筛选已加载岗位'
    };
  }

  if (batchError) {
    return {
      done: true,
      reason: PREVIEW_SCAN_STOP.BATCH_ERROR,
      message: '加载岗位时遇到问题，正在筛选已加载岗位'
    };
  }

  return { done: false, reason: PREVIEW_SCAN_STOP.SCANNING, message: '' };
}
