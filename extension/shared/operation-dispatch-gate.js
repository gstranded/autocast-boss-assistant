(function installOperationDispatchGate(root) {
  "use strict";

  async function awaitOperationDispatchPermit({
    isCancelled = () => false,
    readOperationState = async () => null,
    settleCancellation = async () => {},
    finishCompleted = async () => {},
    yieldTurn = () => new Promise((resolve) => setTimeout(resolve, 0))
  } = {}) {
    const check = async () => {
      if (isCancelled()) {
        await settleCancellation("任务已停止，页面操作已取消");
        return { ok: false, reason: "cancelled" };
      }

      let row = null;
      try { row = await readOperationState(); } catch (_) {}
      if (row?.status === "cancelled") {
        await settleCancellation(row.reason || "任务已停止");
        return { ok: false, reason: "cancelled", row };
      }
      if (row?.status === "done") {
        await finishCompleted(row);
        return { ok: false, reason: "done", row };
      }
      if (isCancelled()) {
        await settleCancellation("任务已停止，页面操作已取消");
        return { ok: false, reason: "cancelled" };
      }
      return { ok: true, reason: "ready", row };
    };

    const beforeYield = await check();
    if (!beforeYield.ok) return beforeYield;
    await yieldTurn();
    return check();
  }

  root.BHTOperationDispatchGate = { awaitOperationDispatchPermit };
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : this
);
