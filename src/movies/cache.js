// In-memory TTL cache for movie provider GET responses.
//
// The public surface (get/set/delete/clear) is deliberately small and async-free
// so the whole thing can later be swapped for a Redis-backed implementation
// behind the same interface without touching callers.

const createTtlCache = ({ now = Date.now } = {}) => {
  const store = new Map();

  const isExpired = entry => entry.expiresAt !== Infinity && entry.expiresAt <= now();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (isExpired(entry)) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, ttlMs) {
      const expiresAt = Number.isFinite(ttlMs) && ttlMs > 0 ? now() + ttlMs : Infinity;
      store.set(key, { value, expiresAt });
      return value;
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    }
  };
};

module.exports = { createTtlCache };
