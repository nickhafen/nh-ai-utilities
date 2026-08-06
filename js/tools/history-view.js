(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml } = ns;

  function relativeTime(ts) {
    const diff = Date.now() - ts;
    const min = 60_000, hr = 3_600_000, day = 86_400_000;
    if (diff < min) return "Just now";
    if (diff < hr) return `${Math.floor(diff / min)}m ago`;
    if (diff < day) return `${Math.floor(diff / hr)}h ago`;
    if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  function historyNoticeHtml() {
    return `
      <div class="history-note">
        <strong>History is local and limited.</strong>
        Saved sessions live only in this browser on this device, are capped at the most recent 30 entries, and can be removed if browser data or local storage is cleared. Export anything you need to keep long term.
      </div>
    `;
  }

  function sessionSummary(session) {
    if (session.inputType === "curriculum") {
      const moduleCount = session.summary?.moduleCount || (session.modulesRaw || session.modules || []).length;
      const placedCount = session.summary?.placedCount ?? Object.keys(session.assignments || {}).length;
      const totalCount = session.summary?.totalCount || 60;
      const moduleNames = (session.modulesRaw || session.modules || [])
        .map((module) => typeof module === "string" ? module : module?.name)
        .filter(Boolean)
        .slice(0, 2)
        .join(", ");
      const parts = [`${moduleCount} module${moduleCount === 1 ? "" : "s"}`, `${placedCount} of ${totalCount} notes placed`];
      if (moduleNames) parts.push(escapeHtml(moduleNames.length > 70 ? moduleNames.slice(0, 70) + "..." : moduleNames));
      return parts.join(" &middot; ");
    }

    if (session.inputType === "conversion") {
      const parts = [`${escapeHtml((session.fileType || "file").toUpperCase())} &rarr; Markdown`];
      if (session.beforeTokens != null && session.afterTokens != null) {
        const fmt = (n) => new Intl.NumberFormat().format(n);
        parts.push(`${fmt(session.beforeTokens)} &rarr; ${fmt(session.afterTokens)} tokens`);
      }
      return parts.join(" &middot; ");
    }

    if (session.inputType === "skill") {
      const words = (session.body || "").trim().split(/\s+/).filter(Boolean).length;
      const parts = [`${words} word${words === 1 ? "" : "s"}`];
      if (session.description) {
        const desc = session.description.length > 60
          ? session.description.slice(0, 60) + "..."
          : session.description;
        parts.push(escapeHtml(desc));
      }
      return parts.join(" &middot; ");
    }

    const total = session.results.length;
    const flagged = session.results.filter(r => r.flag).length;
    const bad = session.results.filter(r => r.status === "unreachable" || r.status === "timeout").length;
    const parts = [`${total} link${total === 1 ? "" : "s"}`];
    if (flagged) parts.push(`<span class="session-stat flagged">${flagged} AI flagged</span>`);
    if (bad) parts.push(`<span class="session-stat bad">${bad} unreachable</span>`);
    return parts.join(" &middot; ");
  }

  ns.registerTool({
    id: "history",
    name: "History",
    render(root) {
      const sessions = ns.history.load();

      if (!sessions.length) {
        root.innerHTML = `
          <div class="tool-view">
            ${historyNoticeHtml()}
            <div class="history-empty">
              <p>No history yet.</p>
              <p class="hint" style="margin-top:0.5rem">Convert a file, analyze a document's links, save a skill, or save a curriculum plan to get started.</p>
            </div>
          </div>
        `;
        return;
      }

      root.innerHTML = `
        <div class="tool-view">
          ${historyNoticeHtml()}
          <div class="history-header">
            <p class="hint">${sessions.length}/30 saved sessions</p>
            <button class="btn btn-subtle" data-clear-history>Clear all</button>
          </div>
          <div class="history-list" data-history-list>
            ${sessions.map(s => sessionCardHtml(s)).join("")}
          </div>
        </div>
      `;

      const list = $("[data-history-list]", root);

      list.addEventListener("click", e => {
        const deleteBtn = e.target.closest("[data-delete-session]");
        if (deleteBtn) {
          const id = deleteBtn.dataset.deleteSession;
          ns.history.remove(id);
          const card = deleteBtn.closest(".session-card");
          if (card) card.remove();
          const remaining = list.querySelectorAll(".session-card").length;
          if (!remaining) {
            root.innerHTML = `
              <div class="tool-view">
                ${historyNoticeHtml()}
                <div class="history-empty">
                  <p>No history yet.</p>
                  <p class="hint" style="margin-top:0.5rem">Convert a file, analyze a document's links, save a skill, or save a curriculum plan to get started.</p>
                </div>
              </div>
            `;
          }
          return;
        }

        const card = e.target.closest(".session-card[data-session-id]");
        if (card) {
          const session = ns.history.get(card.dataset.sessionId);
          if (session) {
            if (session.inputType === "conversion") {
              ns.pendingConverterSession = session;
              window.location.hash = "document-tools";
            } else if (session.inputType === "skill") {
              ns.pendingSkillSession = session;
              window.location.hash = "skill-creator";
            } else if (session.inputType === "curriculum") {
              ns.pendingCurriculumSession = session;
              window.location.hash = "curriculum-planner";
            } else {
              ns.pendingSession = session;
              window.location.hash = "document-tools";
            }
          }
        }
      });

      $("[data-clear-history]", root).addEventListener("click", () => {
        if (!confirm("Clear all history? This cannot be undone.")) return;
        ns.history.clear();
        root.innerHTML = `
          <div class="tool-view">
            ${historyNoticeHtml()}
            <div class="history-empty">
              <p>No history yet.</p>
              <p class="hint" style="margin-top:0.5rem">Convert a file, analyze a document's links, save a skill, or save a curriculum plan to get started.</p>
            </div>
          </div>
        `;
      });
    },
  });

  function sessionCardHtml(s) {
    const kinds = {
      skill:      { badge: `<span class="session-type-badge session-type-skill">SKILL</span>`,           title: "Click to restore this skill" },
      curriculum: { badge: `<span class="session-type-badge session-type-curriculum">PLAN</span>`,       title: "Click to restore this curriculum plan" },
      conversion: { badge: `<span class="session-type-badge session-type-conversion">TOKENS</span>`,     title: "Click to restore this conversion" },
    };
    const kind = kinds[s.inputType] ||
      { badge: `<span class="session-type-badge session-type-doc">DOC</span>`, title: "Click to restore this analysis" };
    const badge = kind.badge;
    const title = kind.title;
    return `
      <div class="session-card" data-session-id="${escapeHtml(s.id)}" role="button" tabindex="0" title="${title}">
        <div class="session-info">
          <div class="session-meta">${badge}${escapeHtml(s.sourceLabel)}</div>
          <div class="session-time">${relativeTime(s.timestamp)}</div>
          <div class="session-summary">${sessionSummary(s)}</div>
        </div>
        <button
          class="session-delete"
          data-delete-session="${escapeHtml(s.id)}"
          title="Delete this session"
          aria-label="Delete session for ${escapeHtml(s.sourceLabel)}"
        >&times;</button>
      </div>
    `;
  }
})();
