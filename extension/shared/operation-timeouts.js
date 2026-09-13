export const OPERATION_TIMEOUTS = Object.freeze({
  DEFAULT_PAGE_MS: 15000,
  CHAT_PAGE_MS: 30000,
  START_CHAT_PAGE_MS: 45000,
  PAGE_PAYLOAD_GRACE_MS: 3000,
  BRIDGE_GRACE_MS: 5000,
  BRIDGE_CANCEL_SETTLE_MS: 3000,
  BRIDGE_CANCEL_POLL_MS: 100,
  PREVIEW_SCROLL_MS: 60000,
  // 岗位采集在绝对截止时间停止；只给结果序列化和 storage 写回留收尾时间。
  PREVIEW_RESULT_GRACE_MS: 3000,
  PREVIEW_LIST_NAV_MS: 30000
});

const CHAT_PAGE_OPERATIONS = new Set([
  'BHT_TRIGGER_CONVERSATION',
  'BHT_WAIT_OPEN_CONVERSATION',
  'BHT_WAIT_CHAT_EDITOR',
  'BHT_SEND_TEXT',
  'BHT_SEND_IMAGE',
  'BHT_RETURN_TO_LIST'
]);

function finiteMs(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function resolvePageOperationTimeoutMs(type, payload = {}, now = Date.now()) {
  if (type === 'BHT_SCAN_JOBS') {
    const deadlineAt = finiteMs(payload?.deadlineAt);
    if (deadlineAt) {
      const collectionRemainingMs = deadlineAt - now;
      if (collectionRemainingMs <= 0) return 0;
      return Math.max(
        0,
        Math.min(OPERATION_TIMEOUTS.PREVIEW_SCROLL_MS, collectionRemainingMs) +
          OPERATION_TIMEOUTS.PREVIEW_RESULT_GRACE_MS
      );
    }
    return OPERATION_TIMEOUTS.PREVIEW_SCROLL_MS + OPERATION_TIMEOUTS.PREVIEW_RESULT_GRACE_MS;
  }

  const baseMs = type === 'BHT_START_CHAT'
    ? OPERATION_TIMEOUTS.START_CHAT_PAGE_MS
    : CHAT_PAGE_OPERATIONS.has(type)
      ? OPERATION_TIMEOUTS.CHAT_PAGE_MS
      : OPERATION_TIMEOUTS.DEFAULT_PAGE_MS;
  const payloadTimeoutMs = finiteMs(payload?.timeoutMs);
  return Math.max(
    baseMs,
    payloadTimeoutMs ? payloadTimeoutMs + OPERATION_TIMEOUTS.PAGE_PAYLOAD_GRACE_MS : 0
  );
}

export function resolveBridgeTimeoutMs(pageOperationTimeoutMs) {
  return finiteMs(pageOperationTimeoutMs, OPERATION_TIMEOUTS.DEFAULT_PAGE_MS) +
    OPERATION_TIMEOUTS.BRIDGE_GRACE_MS;
}

export function isScanResultWithinFinalizationWindow(
  result,
  { collectionDeadlineAt = 0, bridgeDeadlineAt = 0, storageCompletedAt = 0 } = {}
) {
  const collectionDeadline = Number(collectionDeadlineAt || 0);
  if (!collectionDeadline) return true;
  if (Number(storageCompletedAt || 0) <= collectionDeadline) return true;
  const collectionFinishedAt = Number(result?.scanMeta?.collectionFinishedAt || 0);
  const workCompletedAt = Number(result?.scanMeta?.workCompletedAt || 0);
  return Boolean(
    collectionFinishedAt > 0 &&
    collectionFinishedAt <= collectionDeadline &&
    workCompletedAt > 0 &&
    workCompletedAt <= Number(bridgeDeadlineAt || 0)
  );
}
