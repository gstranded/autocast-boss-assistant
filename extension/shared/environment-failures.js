// 环境类失败：岗位页加载/注入/触发等基础设施问题，与用户配置/HR 行为无关。
// 这类失败由队列自动跳过继续下一岗（仅连续达到阈值才暂停），避免单个慢页面卡住整批并反复暂停。
export const ENV_AUTO_CONTINUE_ERRORS = new Set([
  'WORKER_PAGE_NOT_READY',
  'WORKER_CHAT_CLICK_NO_EFFECT',
  'WORKER_CHAT_BUTTON_NOT_FOUND',
  'WORKER_TAB_FAILED',
  'WORKER_TRIGGER_EXCEPTION',
  'WORKER_TRIGGER_EMPTY',
  'WORKER_TARGET_MISSING',
  'TARGET_TAB_CLOSED',
  'RUN_OP_NOT_SUPPORTED',
  'CONTENT_INJECT_FAIL',
  'OP_BRIDGE_TIMEOUT',
  'OP_DEADLINE_EXCEEDED',
  'NO_BOSS_TAB',
  // 临时执行页被 BOSS 重定向/跳转导致操作中断（岗位下架/限流跳转等），属环境类
  'NAVIGATED',
  'WORKER_LEFT_DETAIL'
]);

export function isEnvironmentalFailure(result) {
  return Boolean(result && result.ok !== true && ENV_AUTO_CONTINUE_ERRORS.has(String(result?.error || '')));
}

// 仅「还没点到立即沟通」可重开标签再试。已经点过或可能已建聊的错误禁止重试，避免重复沟通。
export const WORKER_TRIGGER_RETRYABLE_ERRORS = new Set([
  'WORKER_PAGE_NOT_READY',
  'WORKER_CHAT_BUTTON_NOT_FOUND',
  'WORKER_TAB_FAILED',
  'CONTENT_INJECT_FAIL',
  'TARGET_TAB_CLOSED'
]);

export const WORKER_TRIGGER_RETRY = Object.freeze({
  maxTries: 3,
  delayMs: 800
});

export function isWorkerTriggerRetryable(result) {
  if (!result || result.ok === true || result.filtered === true) return false;
  const error = String(result.error || '');
  if (error === 'OP_CANCELLED' || error === 'LOGIN_REQUIRED' || error === 'FILTER_ACTIVE') return false;
  return WORKER_TRIGGER_RETRYABLE_ERRORS.has(error);
}

export function canFallbackWorkerMode(result) {
  return isWorkerTriggerRetryable(result);
}
