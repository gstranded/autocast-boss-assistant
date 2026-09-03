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

// 本地日期起始/结束毫秒（含边界：from 取当天 00:00:00，to 取当天 23:59:59.999）
export function startOfLocalDay(ts) {
  const d = new Date(Number(ts || Date.now()));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfLocalDay(ts) {
  const d = new Date(Number(ts || Date.now()));
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// 按开始/结束日期（传入当天任一时刻即可）过滤记录，含边界；0 表示不限
export function filterHistoryByDate(history = [], fromTs = 0, toTs = 0) {
  const rows = Array.isArray(history) ? history : [];
  const from = Number(fromTs) > 0 ? startOfLocalDay(fromTs) : 0;
  const to = Number(toTs) > 0 ? endOfLocalDay(toTs) : 0;
  if (!from && !to) return rows.slice();
  return rows.filter((row) => {
    const ts = Number(row?.ts || 0);
    if (!ts) return false;
    if (from && ts < from) return false;
    if (to && ts > to) return false;
    return true;
  });
}

// 汇总统计：共 / 成功 / 跳过 / 失败（跳过的归类与列表 historyRowClass 一致：
// unknown 状态按「跳过」处理，保证统计与列表显示不矛盾）
export function summarizeHistory(history = []) {
  const rows = Array.isArray(history) ? history : [];
  const total = rows.length;
  const successCount = rows.filter((h) => h?.status === 'success').length;
  const failCount = rows.filter((h) => h?.status === 'failed').length;
  const skipCount = Math.max(0, total - successCount - failCount);
  return { total, success: successCount, skipped: skipCount, failed: failCount };
}
