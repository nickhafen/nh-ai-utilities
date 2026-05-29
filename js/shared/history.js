(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  const KEY = "ai-utilities-history";
  const MAX = 30;

  ns.history = {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
      catch { return []; }
    },

    save(sessions) {
      try {
        localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, MAX)));
      } catch {
        // If storage is full, drop the oldest half and retry
        try {
          localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, Math.floor(MAX / 2))));
        } catch { /* give up */ }
      }
    },

    add(session) {
      const sessions = this.load();
      sessions.unshift(session);
      this.save(sessions);
    },

    update(id, updates) {
      const sessions = this.load();
      const i = sessions.findIndex(s => s.id === id);
      if (i >= 0) {
        sessions[i] = { ...sessions[i], ...updates };
        this.save(sessions);
      }
    },

    remove(id) {
      this.save(this.load().filter(s => s.id !== id));
    },

    get(id) {
      return this.load().find(s => s.id === id) || null;
    },

    clear() {
      localStorage.removeItem(KEY);
    },
  };
})();
