export const PAGE_CLOCK_PORT = 'bht-page-clock';
export const PAGE_CLOCK_MAX_DELAY_MS = 2000;

// Extension worker timers keep short waits independent of hidden-page timer throttling.
export function attachPageClock(port, { allowSender, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (port.name !== PAGE_CLOCK_PORT) return false;
  if (!allowSender?.(port.sender)) {
    port.disconnect();
    return true;
  }
  const timers = new Map();
  let closed = false;
  const reply = (message) => {
    if (!closed) try { port.postMessage(message); } catch (_) {}
  };
  port.onMessage.addListener((message) => {
    const id = message?.id;
    const waitMs = message?.waitMs;
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(waitMs) || waitMs < 0 || waitMs > PAGE_CLOCK_MAX_DELAY_MS || timers.has(id)) {
      reply({ id, ok: false, error: 'PAGE_CLOCK_BAD_REQUEST' });
      return;
    }
    timers.set(id, setTimer(() => {
      timers.delete(id);
      reply({ id, ok: true });
    }, waitMs));
  });
  port.onDisconnect.addListener(() => {
    closed = true;
    for (const timer of timers.values()) clearTimer(timer);
    timers.clear();
  });
  return true;
}
