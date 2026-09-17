(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  const KEY = "ai-utilities-history";
  const MAX = 30;

  ns.history = {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
      catch { return []; }
    },

    // Returns true if the sessions were written, false if storage is full or
    // blocked. Callers that don't care can ignore the result.
    save(sessions) {
      try {
        localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, MAX)));
        return true;
      } catch {
        // If storage is full, drop the oldest half and retry
        try {
          localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, Math.floor(MAX / 2))));
          return true;
        } catch {
          return false;
        }
      }
    },

    add(session) {
      const sessions = this.load();
      sessions.unshift(session);
      return this.save(sessions);
    },

    // Returns false if the session no longer exists or couldn't be saved.
    update(id, updates) {
      const sessions = this.load();
      const i = sessions.findIndex(s => s.id === id);
      if (i < 0) return false;
      sessions[i] = { ...sessions[i], ...updates };
      return this.save(sessions);
    },

    remove(id) {
      return this.save(this.load().filter(s => s.id !== id));
    },

    get(id) {
      return this.load().find(s => s.id === id) || null;
    },

    clear() {
      localStorage.removeItem(KEY);
    },
  };
})();
