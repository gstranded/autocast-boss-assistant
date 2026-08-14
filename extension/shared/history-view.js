export const HISTORY_STATUS_MAP = {
  success: { label: '成功', cls: 'success' },
  skipped_list: { label: '跳过', cls: 'skipped' },
  conversation_not_found: { label: '跳过', cls: 'skipped' },
  skipped_missing: { label: '跳过', cls: 'skipped' },
  failed: { label: '失败', cls: 'failed' }
};

export function historyRowClass(status) {
  return (HISTORY_STATUS_MAP[status] || { cls: 'skipped' }).cls;
}

export function filterHistoryRows(history = [], filter = 'all') {
  const rows = Array.isArray(history) ? history : [];
  if (!filter || filter === 'all') return rows.slice();
  return rows.filter((row) => historyRowClass(row?.status) === filter);
}
