import { JOB_SOURCE_TYPES, sameFilterSignature, sameJobSourceContext } from './job-expect-context.js';

// 搜索结果不会因刷新自动换一批。采集预算用完但尚未到底时，继续原页面的
// 扫描会话和滚动位置，避免每轮都把预算花在同一段结果上。
export function resolveTargetSearchContinuation(task, currentContext, tabId) {
  const scan = task?.scanMeta || {};
  if (
    task?.targetMode !== true ||
    task?.sourceContext?.sourceType !== JOB_SOURCE_TYPES.SEARCH ||
    scan.reachedEnd === true ||
    scan.timedOut !== true ||
    !scan.sessionId ||
    scan.scanTabId !== tabId ||
    !sameJobSourceContext(task.sourceContext, currentContext) ||
    !sameFilterSignature(task.sourceContext.filterSignature, currentContext?.filterSignature)
  ) return null;
  const scrollTop = Number(scan.scrollTop);
  if (!Number.isFinite(scrollTop) || scrollTop < 0) return null;
  return { scanSessionId: String(scan.sessionId), scrollTop };
}
