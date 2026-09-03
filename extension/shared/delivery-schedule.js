export const DEFAULT_DELIVERY_SCHEDULE_DAYS = Object.freeze([1, 2, 3, 4, 5]);

export const DELIVERY_SCHEDULE_WINDOWS = Object.freeze([
  Object.freeze({ startMinute: 9 * 60, endMinute: 12 * 60, label: '09:00-12:00' }),
  Object.freeze({ startMinute: 14 * 60, endMinute: 17 * 60, label: '14:00-17:00' })
]);

const WEEKDAY_LABELS = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六']);

export function normalizeDeliveryScheduleDays(days) {
  if (!Array.isArray(days)) return [...DEFAULT_DELIVERY_SCHEDULE_DAYS];
  return [...new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
}

function localTimeAt(day, minute) {
  const value = new Date(day);
  value.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return value;
}

export function nextDeliveryScheduleStart(settings = {}, now = new Date()) {
  if (settings.scheduledDeliveryEnabled !== true) return null;
  const days = normalizeDeliveryScheduleDays(settings.scheduledDeliveryDays);
  if (!days.length) return null;

  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    if (!days.includes(day.getDay())) continue;
    for (const window of DELIVERY_SCHEDULE_WINDOWS) {
      const candidate = localTimeAt(day, window.startMinute);
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  return null;
}

export function evaluateDeliverySchedule(settings = {}, now = new Date()) {
  const enabled = settings.scheduledDeliveryEnabled === true;
  const days = normalizeDeliveryScheduleDays(settings.scheduledDeliveryDays);
  if (!enabled) {
    return { enabled: false, allowed: true, days, activeWindow: null, nextStart: null };
  }

  const minute = now.getHours() * 60 + now.getMinutes();
  const activeWindow = days.includes(now.getDay())
    ? DELIVERY_SCHEDULE_WINDOWS.find((window) => minute >= window.startMinute && minute < window.endMinute) || null
    : null;
  return {
    enabled: true,
    allowed: Boolean(activeWindow),
    days,
    activeWindow,
    nextStart: activeWindow ? null : nextDeliveryScheduleStart(settings, now)
  };
}

export function formatDeliveryScheduleStatus(settings = {}, now = new Date()) {
  const state = evaluateDeliverySchedule(settings, now);
  if (!state.enabled) return '定时投递已关闭';
  if (!state.days.length) return '未选择运行日，定时任务不会启动';
  if (state.allowed) return `当前可投递 · ${state.activeWindow.label}`;
  if (!state.nextStart) return '当前不在投递时段';
  const next = state.nextStart;
  const time = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
  return `当前暂停 · 下次 ${WEEKDAY_LABELS[next.getDay()]} ${time}`;
}
