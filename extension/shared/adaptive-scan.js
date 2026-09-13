export const ADAPTIVE_SCAN_STOP = Object.freeze({
  TARGET_MET: 'target_met',
  REACHED_END: 'reached_end',
  TIMEOUT: 'timeout',
  MAX_JOBS: 'max_jobs',
  STALLED: 'stalled'
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function decideAdaptiveScan({
  scanned = 0,
  pass = 0,
  targetPass = 30,
  minScanned = 45,
  maxScanned = 300,
  elapsedMs = 0,
  maxElapsedMs = 50000,
  reachedEnd = false,
  batchAdded = 0,
  zeroGrowthBatches = 0
} = {}) {
  const safeScanned = Math.max(0, Number(scanned || 0));
  const safePass = Math.max(0, Number(pass || 0));
  const safeTarget = Math.max(1, Number(targetPass || 1));
  const passRate = safeScanned ? safePass / safeScanned : 0;
  const stop = (reason, message) => ({
    continue: false,
    reason,
    message,
    passRate,
    nextRounds: 0
  });

  if (reachedEnd) return stop(ADAPTIVE_SCAN_STOP.REACHED_END, '已扫描到职位列表底部');
  if (elapsedMs >= maxElapsedMs) return stop(ADAPTIVE_SCAN_STOP.TIMEOUT, '已达到扫描最长时间');
  if (safeScanned >= maxScanned) return stop(ADAPTIVE_SCAN_STOP.MAX_JOBS, '已达到单次扫描岗位上限');
  if (safeScanned >= minScanned && safePass >= safeTarget) {
    return stop(ADAPTIVE_SCAN_STOP.TARGET_MET, '符合岗位已达到本次投递目标');
  }
  if (zeroGrowthBatches >= 2 && batchAdded <= 0) {
    return stop(ADAPTIVE_SCAN_STOP.STALLED, '连续滚动未加载到新岗位');
  }

  const remainingMs = Math.max(0, maxElapsedMs - elapsedMs);
  let nextRounds = 5;
  if (safeScanned < minScanned) nextRounds = 6;
  if (safeScanned >= minScanned && passRate < 0.15) nextRounds = 8;
  if (safeScanned >= minScanned && passRate < 0.05) nextRounds = 10;
  if (safePass === 0 && safeScanned >= minScanned) nextRounds = 10;
  if (passRate > 0 && safePass < safeTarget) {
    const estimatedMoreJobs = Math.ceil((safeTarget - safePass) / passRate);
    nextRounds = Math.max(nextRounds, clamp(Math.ceil(estimatedMoreJobs / 5), 4, 10));
  }
  if (remainingMs < 10000) nextRounds = Math.min(nextRounds, 4);

  return {
    continue: true,
    reason: 'continue',
    message: passRate < 0.05 && safeScanned >= minScanned
      ? '通过率较低，继续向下加载更多岗位'
      : '继续加载岗位以满足本次投递目标',
    passRate,
    nextRounds: clamp(nextRounds, 3, 10)
  };
}
