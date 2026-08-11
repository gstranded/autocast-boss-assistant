export function createOperationRegistry() {
  const active = new Map();

  return Object.freeze({
    add(op) {
      if (op?.opId) active.set(op.opId, { ...op });
      return op;
    },
    delete(opId) {
      active.delete(opId);
    },
    list() {
      return Array.from(active.values());
    },
    clear() {
      const entries = Array.from(active.values());
      active.clear();
      return entries;
    },
    get size() {
      return active.size;
    }
  });
}
