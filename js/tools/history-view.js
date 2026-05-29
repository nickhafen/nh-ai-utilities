(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml } = ns;

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    const min = 60_000, hr = 3_600_000, day = 86_400_000;
    if (diff < min)       return "Just now";
    if (diff < hr)        return `${Math.floor(diff / min)}m ago`;
    if (diff < day)       return `${Math.floor(diff / hr)}h ago`;
    if (diff < 7 * day)   return `${Math.floor(diff / day)}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  function sessionSummary(session) {
    const total   = session.results.length;
    const flagged = session.results.filter(r => r.flag).length;
    const bad     = session.results.filter(r => r.status === "unreachable" || r.status === "timeout").length;
    const parts = [`${total} link${total === 1 ? "" : "s"}`];
    if (flagged) parts.push(`<span class="session-stat flagged">${flagged} AI flagged</span>`);
    if (bad)     parts.push(`<span class="session-stat bad">${bad} unreachable</span>`);
    return parts.join(" · ");
  }

  ns.registerTool({
    id: "history",
    name: "History",
    render(root) {
      const sessions = ns.history.load();

      if (!sessions.length) {
        root.innerHTML = `
          <div class="tool-view">
            <div class="history-empty">
              <p>No history yet.</p>
              <p class="hint" style="margin-top:0.5rem">Analyze a document to get started.</p>
            </div>
          </div>
        `;
        return;
      }

      root.innerHTML = `
        <div class="tool-view">
          <div class="history-header">
            <p class="hint">${sessions.length} saved session${sessions.length === 1 ? "" : "s"} · stored in this browser on this device</p>
            <button class="btn btn-subtle" data-clear-history>Clear all</button>
          </div>
          <div class="history-list" data-history-list>
            ${sessions.map(s => sessionCardHtml(s)).join("")}
          </div>
        </div>
      `;

      const list = $("[data-history-list]", root);

      list.addEventListener("click", e => {
        // Delete button
        const deleteBtn = e.target.closest("[data-delete-session]");
        if (deleteBtn) {
          const id = deleteBtn.dataset.deleteSession;
          ns.history.remove(id);
          const card = deleteBtn.closest(".session-card");
          if (card) card.remove();
          const remaining = list.querySelectorAll(".session-card").length;
          if (!remaining) {
            list.innerHTML = `<p class="hint">No history yet.</p>`;
            $("[data-history-list]", root)?.previousElementSibling?.remove();
          }
          return;
        }

        // Restore session
        const card = e.target.closest(".session-card[data-session-id]");
        if (card) {
          const session = ns.history.get(card.dataset.sessionId);
          if (session) {
            ns.pendingSession = session;
            window.location.hash = "analyzer";
          }
        }
      });

      $("[data-clear-history]", root).addEventListener("click", () => {
        if (!confirm("Clear all history? This cannot be undone.")) return;
        ns.history.clear();
        root.innerHTML = `
          <div class="tool-view">
            <div class="history-empty">
              <p>No history yet.</p>
              <p class="hint" style="margin-top:0.5rem">Analyze a document to get started.</p>
            </div>
          </div>
        `;
      });
    },
  });

  function sessionCardHtml(s) {
    return `
      <div class="session-card" data-session-id="${escapeHtml(s.id)}" role="button" tabindex="0"
           title="Click to restore this analysis">
        <div class="session-info">
          <div class="session-meta">${escapeHtml(s.sourceLabel)}</div>
          <div class="session-time">${relativeTime(s.timestamp)}</div>
          <div class="session-summary">${sessionSummary(s)}</div>
        </div>
        <button
          class="session-delete"
          data-delete-session="${escapeHtml(s.id)}"
          title="Delete this session"
          aria-label="Delete session for ${escapeHtml(s.sourceLabel)}"
        >×</button>
      </div>
    `;
  }
})();
