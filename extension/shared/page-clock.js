(function installPageClock(root) {
  "use strict";
  const PORT_NAME = "bht-page-clock";
  const MAX_DELAY_MS = 2000;

  function createPageClock({ connect, isHidden, isCancelled = () => false, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let port = null;
    let sequence = 0;
    const pending = new Map();
    const error = (code) => Object.assign(new Error(code), { code });

    function settle(id, failure = null) {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (request.timer != null) clearTimer(request.timer);
      if (failure) request.reject(failure);
      else if (isCancelled(request.opId)) request.reject(error("OP_CANCELLED"));
      else request.resolve();
    }

    function getPort() {
      if (port) return port;
      const current = connect(PORT_NAME);
      port = current;
      current.onMessage.addListener((message) => {
        if (port !== current) return;
        settle(message?.id, message?.ok === true ? null : error(message?.error || "PAGE_CLOCK_FAILED"));
      });
      current.onDisconnect.addListener(() => {
        if (port !== current) return;
        port = null;
        for (const [id, request] of pending) {
          if (request.remote) settle(id, error("PAGE_CLOCK_DISCONNECTED"));
        }
      });
      return current;
    }

    function wait(ms, opId) {
      if (isCancelled(opId)) return Promise.reject(error("OP_CANCELLED"));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const remote = isHidden();
        const request = { opId, remote, resolve, reject, timer: null };
        pending.set(id, request);
        try {
          if (remote) getPort().postMessage({ id, waitMs: ms });
          else request.timer = setTimer(() => settle(id), ms);
        } catch (_) {
          settle(id, error("PAGE_CLOCK_UNAVAILABLE"));
        }
      });
    }

    async function sleep(ms, opId = null) {
      const duration = Number(ms);
      let remaining = Number.isFinite(duration) ? Math.max(0, duration) : 0;
      do {
        const chunk = Math.min(MAX_DELAY_MS, remaining);
        await wait(chunk, opId);
        remaining -= chunk;
      } while (remaining > 0);
    }

    function cancel(opId) {
      for (const [id, request] of pending) {
        if (request.opId === opId) settle(id, error("OP_CANCELLED"));
      }
    }

    function dispose() {
      for (const id of pending.keys()) settle(id, error("PAGE_CLOCK_DISCONNECTED"));
      const current = port;
      port = null;
      try { current?.disconnect(); } catch (_) {}
    }

    return { sleep, cancel, dispose };
  }

  root.BHTPageClock = { PORT_NAME, MAX_DELAY_MS, createPageClock };
})(globalThis);
