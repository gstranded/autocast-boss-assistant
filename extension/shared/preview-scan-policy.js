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
      message: `已达到 ${Math.round(Number(maxElapsedMs || 0) / 1000)} 秒滚动上限，开始筛选当前累计岗位`
    };
  }

  if (terminal.reachedEnd) {
    return {
      done: true,
      reason: PREVIEW_SCAN_STOP.REACHED_END,
      message: '已滚动到职位列表底部，开始筛选'
    };
  }

  if (batchError) {
    return {
      done: true,
      reason: PREVIEW_SCAN_STOP.BATCH_ERROR,
      message: String(batchError)
    };
  }

  return { done: false, reason: PREVIEW_SCAN_STOP.SCANNING, message: '' };
}
