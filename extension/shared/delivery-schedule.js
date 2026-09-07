export const DEFAULT_DELIVERY_SCHEDULE_DAYS = Object.freeze([1, 2, 3, 4, 5]);

// 设置里保存的默认时段（HH:MM 24 小时制），可在面板自定义
export const DEFAULT_DELIVERY_SCHEDULE_WINDOWS = Object.freeze([
  Object.freeze({ start: '09:00', end: '12:00' }),
  Object.freeze({ start: '14:00', end: '17:00' })
]);

// 最多可配置的时段数量
export const MAX_DELIVERY_SCHEDULE_WINDOWS = 10;

// 兼容旧引用：默认时段的分钟表示
function toDefaultWindow(stringWindow) {
  const startMinute = parseClock(stringWindow.start);
  const endMinute = parseClock(stringWindow.end);
  return { startMinute, endMinute, label: `${stringWindow.start}-${stringWindow.end}` };
}
export const DELIVERY_SCHEDULE_WINDOWS = Object.freeze(
  DEFAULT_DELIVERY_SCHEDULE_WINDOWS.map(toDefaultWindow).map(Object.freeze)
);

const WEEKDAY_LABELS = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六']);

export function normalizeDeliveryScheduleDays(days) {
  if (!Array.isArray(days)) return [...DEFAULT_DELIVERY_SCHEDULE_DAYS];
  return [...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
}

function parseClock(text) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClock(minute) {
  const value = Math.max(0, Math.min(23 * 60 + 59, Math.round(minute)));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

// 输入：settings（用 settings.scheduledDeliveryWindows）或直接给数组；
// 返回规范化数组 [{ startMinute, endMinute, label }]（按开始时间排序、去重、仅保留 start<end 的合法项）。
// 缺失/未设置时返回默认两个时段；传显式空数组或全部非法时返回空数组（表示没有有效时段）。
export function normalizeDeliveryScheduleWindows(input) {
  let raw;
  if (Array.isArray(input?.scheduledDeliveryWindows)) {
    raw = input.scheduledDeliveryWindows;
  } else if (Array.isArray(input)) {
    raw = input;
  } else {
    raw = DEFAULT_DELIVERY_SCHEDULE_WINDOWS;
  }
  const parsed = raw
    .map((w) => {
      const startMinute = parseClock(w?.start);
      const endMinute = parseClock(w?.end);
      if (startMinute == null || endMinute == null || startMinute >= endMinute) return null;
      return {
        startMinute,
        endMinute,
        label: `${formatClock(startMinute)}-${formatClock(endMinute)}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinute - b.startMinute);
  const seen = new Set();
  return parsed.filter((w) => {
    const key = w.startMinute + ':' + w.endMinute;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_DELIVERY_SCHEDULE_WINDOWS);
}

function localTimeAt(day, minute) {
  const value = new Date(day);
  value.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return value;
}

// 诊断面板原始输入（按行序），只读不改值：
// invalid=格式/起止颠倒（不生效）；duplicate=与更早条目完全相同（只保留一条）；
// overlap=与更早条目部分重叠（两条都生效，投递时段取并集）
export function diagnoseDeliveryScheduleWindows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const valid = [];
  return list.map((row, index) => {
    const startMinute = parseClock(row?.start);
    const endMinute = parseClock(row?.end);
    if (startMinute == null || endMinute == null) {
      return { index, status: 'invalid', ofIndex: null, reason: '时间格式无效，该时段不生效' };
    }
    if (startMinute >= endMinute) {
      return { index, status: 'invalid', ofIndex: null, reason: '开始需早于结束，该时段不生效' };
    }
    const same = valid.findIndex((w) => w.startMinute === startMinute && w.endMinute === endMinute);
    if (same >= 0) {
      return { index, status: 'duplicate', ofIndex: valid[same].rowIndex, reason: `与时段 ${valid[same].rowIndex + 1} 完全相同，重复时段不生效` };
    }
    const overlapIndex = valid.findIndex((w) => startMinute < w.endMinute && endMinute > w.startMinute);
    if (overlapIndex >= 0) {
      return { index, status: 'overlap', ofIndex: valid[overlapIndex].rowIndex, reason: `与时段 ${valid[overlapIndex].rowIndex + 1} 部分重叠，投递时段取并集` };
    }
    valid.push({ startMinute, endMinute, rowIndex: index });
    return { index, status: 'ok', ofIndex: null, reason: '' };
  });
}

export function nextDeliveryScheduleStart(settings = {}, now = new Date()) {
  if (settings.scheduledDeliveryEnabled !== true) return null;
  const days = normalizeDeliveryScheduleDays(settings.scheduledDeliveryDays);
  const windows = normalizeDeliveryScheduleWindows(settings.scheduledDeliveryWindows);
  if (!days.length || !windows.length) return null;

  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    if (!days.includes(day.getDay())) continue;
    for (const window of windows) {
      const candidate = localTimeAt(day, window.startMinute);
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  return null;
}

export function evaluateDeliverySchedule(settings = {}, now = new Date()) {
  const enabled = settings.scheduledDeliveryEnabled === true;
  const days = normalizeDeliveryScheduleDays(settings.scheduledDeliveryDays);
  const windows = normalizeDeliveryScheduleWindows(settings.scheduledDeliveryWindows);
  if (!enabled) {
    return { enabled: false, allowed: true, days, windows, activeWindow: null, nextStart: null };
  }

  const minute = now.getHours() * 60 + now.getMinutes();
  const activeWindow = days.includes(now.getDay())
    ? windows.find((window) => minute >= window.startMinute && minute < window.endMinute) || null
    : null;
  return {
    enabled: true,
    allowed: Boolean(activeWindow),
    days,
    windows,
    activeWindow,
    nextStart: activeWindow ? null : nextDeliveryScheduleStart(settings, now)
  };
}

export function formatDeliveryScheduleStatus(settings = {}, now = new Date()) {
  const state = evaluateDeliverySchedule(settings, now);
  if (!state.enabled) return '定时投递已关闭';
  if (!state.days.length) return '未选择运行日，定时任务不会启动';
  if (!state.windows.length) return '未设置有效投递时段，任务不会自动运行';
  if (state.allowed) return `当前可投递 · ${state.activeWindow.label}`;
  if (!state.nextStart) return '当前不在投递时段';
  const next = state.nextStart;
  const time = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
  return `当前暂停 · 下次 ${WEEKDAY_LABELS[next.getDay()]} ${time}`;
}
