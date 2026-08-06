(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml, copyText, highlightMatches } = ns;

  const DEFAULT_TAGS = [
    "utm_source=chatgpt.com",
    "utm_source=openai",
    "utm_source=copilot.com",
    "utm_source=gemini",
    "utm_source=perplexity",
    "utm_source=perplexity.ai",
    "utm_source=gemini.google.com",
    "utm_source=mistral",
    "referrer=grok.com",
  ];

  const CONCURRENCY = 6;
  const TIMEOUT_MS = 8000;

  // ── Link reachability check ───────────────────────────────────────────────

  async function checkUrl(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
      return "reachable";
    } catch (e) {
      return e.name === "AbortError" ? "timeout" : "unreachable";
    } finally {
      clearTimeout(t);
    }
  }

  // ── Tag matching ──────────────────────────────────────────────────────────

  function applyTags(links, tags) {
    return links.map(({ visibleText, url }) => {
      const flaggedTags = tags.filter(t => url.toLowerCase().includes(t.toLowerCase()));
      return { visibleText, url, flag: flaggedTags.length > 0, flaggedTags, status: "pending" };
    });
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  function toUrlsCSV(rows) {
    const esc = v => `"${String(v || "").replace(/"/g, '""')}"`;
    const lines = [
      ["Visible Text", "Destination URL"].map(esc).join(","),
      ...rows.map(r => [r.visibleText, r.url].map(esc).join(",")),
    ];
    return lines.join("\n");
  }

  function toIndicatorsCSV(rows) {
    const esc = v => `"${String(v || "").replace(/"/g, '""')}"`;
    const lines = [
      ["Visible Text", "Destination URL", "AI Flag", "Status"].map(esc).join(","),
      ...rows.map(r => [
        r.visibleText,
        r.url,
        r.flag ? "Yes" : "No",
        r.status === "pending" || r.status === "checking" ? "" : r.status,
      ].map(esc).join(",")),
    ];
    return lines.join("\n");
  }

  function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Status badge HTML ─────────────────────────────────────────────────────

  function statusBadge(status) {
    const map = {
      pending:     ["badge-pending",     "—"],
      checking:    ["badge-pending",     "Checking…"],
      reachable:   ["badge-reachable",   "Reachable"],
      unreachable: ["badge-unreachable", "Unreachable"],
      timeout:     ["badge-timeout",     "Timed out"],
    };
    const [cls, label] = map[status] || map.pending;
    return `<span class="link-badge ${cls}">${label}</span>`;
  }

  // ── Copy with visual feedback ─────────────────────────────────────────────

  async function copyWithFeedback(btn, getText) {
    const orig = btn.textContent;
    btn.disabled = true;
    try {
      await copyText(getText());
      btn.textContent = "✓ Copied";
      btn.classList.add("btn-success");
    } catch {
      btn.textContent = "✗ Failed";
    }
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove("btn-success");
      btn.disabled = false;
    }, 2000);
  }

  function emptyResultsHtml() {
    return `<div class="history-empty"><p>No links found in this document.</p></div>`;
  }

  // ── Extract URLs workflow ───────────────────────────────────────────────────
  //
  // Mounted by the Document Tools rail (js/tools/document-tools.js), which
  // extracts links from whatever document is active (file or pasted text) and
  // hands the same list to this module and to the AI Indicators module via
  // setLinks(). This workflow is the lightweight "just get the URLs" view —
  // no tag flagging, no reachability checks.

  const SEPARATORS = {
    newline: { label: "New line", value: "\n" },
    space:   { label: "Space",    value: " " },
    tab:     { label: "Tab",      value: "\t" },
    comma:   { label: "Comma",    value: ", " },
  };

  ns.mountExtractUrlsWorkflow = function mountExtractUrlsWorkflow(root) {
    let results = [];
    let sourceLabel = "";
    let separator = "newline";

    render();

    function render() {
      root.innerHTML = `
        <div class="tool-view">
          ${results.length ? resultsPanelHtml() : emptyResultsHtml()}
        </div>
      `;
      bindHandlers();
    }

    function resultsPanelHtml() {
      return `
        <section class="panel results-panel">
          <div class="panel-header">
            <div class="panel-actions">
              <span class="panel-title">All Links</span>
              <span class="count-pill">${results.length} link${results.length === 1 ? "" : "s"}</span>
            </div>
            <div class="panel-actions">
              <label class="separator-label" for="extract-url-separator">Separator
                <select id="extract-url-separator" class="select-input" data-separator>
                  ${Object.entries(SEPARATORS).map(([key, { label }]) => `
                    <option value="${key}" ${key === separator ? "selected" : ""}>${escapeHtml(label)}</option>
                  `).join("")}
                </select>
              </label>
              <button class="btn btn-secondary" data-copy-urls>Copy URLs</button>
              <div class="export-wrap">
                <button class="btn btn-secondary" data-export-toggle>Export ▾</button>
                <div class="export-menu" data-export-menu hidden>
                  <button data-export="copy-csv">Copy as CSV</button>
                  <button data-export="download-csv">Download CSV</button>
                </div>
              </div>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th class="col-text">Visible Text</th>
                  <th class="col-url">Destination URL</th>
                  <th class="col-check"></th>
                </tr>
              </thead>
              <tbody>
                ${results.map((r, i) => `
                  <tr>
                    <td class="col-text" title="${escapeHtml(r.visibleText || "")}">${r.visibleText ? escapeHtml(r.visibleText) : '<span class="empty">—</span>'}</td>
                    <td class="col-url"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="url-link">${escapeHtml(r.url)}</a></td>
                    <td class="col-check"><input type="checkbox" data-row-check="${i}" ${r.checked ? "checked" : ""} aria-label="Include this link"></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    function checkedResults() {
      return results.filter((r) => r.checked);
    }

    function bindHandlers() {
      const separatorSelect = $("[data-separator]", root);
      if (separatorSelect) separatorSelect.addEventListener("change", () => { separator = separatorSelect.value; });

      const tbody = $("tbody", root);
      if (tbody) {
        tbody.addEventListener("change", (e) => {
          const cb = e.target.closest("[data-row-check]");
          if (!cb) return;
          results[Number(cb.dataset.rowCheck)].checked = cb.checked;
        });
      }

      const copyBtn = $("[data-copy-urls]", root);
      if (copyBtn) copyBtn.addEventListener("click", () => copyWithFeedback(copyBtn, () => checkedResults().map(r => r.url).join(SEPARATORS[separator].value)));

      const exportToggle = $("[data-export-toggle]", root);
      const exportMenu = $("[data-export-menu]", root);
      if (exportToggle && exportMenu) {
        exportToggle.addEventListener("click", (e) => { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; });
        exportMenu.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-export]");
          if (!btn) return;
          exportMenu.hidden = true;
          const slug = sourceLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
          if (btn.dataset.export === "copy-csv") copyWithFeedback(exportToggle, () => toUrlsCSV(checkedResults()));
          else downloadCSV(toUrlsCSV(checkedResults()), `${slug || "links"}.csv`);
        });
        root.addEventListener("click", (e) => { if (!e.target.closest(".export-wrap")) exportMenu.hidden = true; });
      }
    }

    // Called by the rail whenever the active document (file or pasted text)
    // changes. `links` is the raw extracted list, already deduped/cleaned.
    function setLinks(links, label) {
      results = links.map((l) => ({ ...l, checked: true }));
      sourceLabel = label;
      render();
    }

    function reset() {
      results = [];
      sourceLabel = "";
      render();
    }

    return { setLinks, reset };
  };

  // ── Check AI Indicators workflow ────────────────────────────────────────────
  //
  // Also mounted by the rail via setLinks(). Applies AI-tracking-tag flags to
  // the shared link list and checks each URL's reachability, surfacing both
  // as "indicators" worth a second look before sharing a document.

  ns.mountAiIndicatorsWorkflow = function mountAiIndicatorsWorkflow(root) {
    let tags = [...DEFAULT_TAGS];
    let results = [];
    let sourceLabel = "";
    let sessionId = null;
    let tagsExpanded = false;
    let activeFilter = null; // null | "flagged" | "bad"
    let sortCol = null;      // null | "flag" | "status"
    let sortDir = "asc";

    render();

    function render() {
      const flagged = results.filter(r => r.flag).length;
      const bad = results.filter(r => r.status === "unreachable" || r.status === "timeout").length;

      root.innerHTML = `
        <div class="tool-view">
          <details class="converter-notes" data-tags-details ${tagsExpanded ? "open" : ""}>
            <summary data-toggle-tags>Configure AI URL tags</summary>
            <div class="converter-notes-body" data-tags-body>
              <p style="margin:0">URLs containing any of these strings are flagged in the AI Flag column. Changes apply the next time a document is analyzed.</p>
              <div class="tags-row" data-tags-list></div>
              <div class="add-row">
                <input class="text-input" data-tag-input type="text" placeholder="Add a tag…">
                <button class="btn btn-secondary" data-add-tag>Add</button>
              </div>
            </div>
          </details>

          ${results.length ? resultsPanelHtml(flagged, bad) : emptyResultsHtml()}
        </div>
      `;

      renderTags();
      bindHandlers();
    }

    function resultsPanelHtml(flagged, bad) {
      return `
        <dl class="column-guide">
          <div><dt>AI Flag</dt><dd>Flagged if the URL contains a known AI platform tracking tag (e.g. <code>utm_source=chatgpt.com</code>). Customize the tag list above.</dd></div>
          <div><dt>Status</dt><dd>Whether the URL responded when checked. <em>Reachable</em> means a server responded — not that the page exists (a 404 still shows as Reachable). Some legitimate links redirected by services like LinkedIn or Google may also show as Unreachable.</dd></div>
        </dl>

        <section class="panel results-panel">
          <div class="panel-header">
            <div class="panel-actions">
              <span class="count-pill">${results.length} link${results.length === 1 ? "" : "s"}</span>
              <button class="count-pill count-pill-warn" data-filter="flagged" ${flagged ? "" : "hidden"}>${flagged} AI flagged</button>
              <button class="count-pill count-pill-bad" data-filter="bad" ${bad ? "" : "hidden"}>${bad} unreachable</button>
              <span class="filter-indicator" data-filter-indicator hidden></span>
            </div>
            <div class="panel-actions">
              <div class="export-wrap">
                <button class="btn btn-secondary" data-export-toggle>Export ▾</button>
                <div class="export-menu" data-export-menu hidden>
                  <button data-export="copy-csv">Copy as CSV</button>
                  <button data-export="download-csv">Download CSV</button>
                </div>
              </div>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th class="col-text">Visible Text</th>
                  <th class="col-url">Destination URL</th>
                  <th class="col-flag col-sortable" data-sort-col="flag">AI Flag <span class="sort-icon" aria-hidden="true"></span></th>
                  <th class="col-status col-sortable" data-sort-col="status">Status <span class="sort-icon" aria-hidden="true"></span></th>
                </tr>
              </thead>
              <tbody>
                ${results.map((r, i) => rowHtml(r, i)).join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    function renderTags() {
      const list = $("[data-tags-list]", root);
      if (!list) return;
      list.innerHTML = tags.map((tag, i) => `
        <span class="tag-chip">
          ${escapeHtml(tag)}
          <button data-tag-index="${i}" aria-label="Remove ${escapeHtml(tag)}">×</button>
        </span>
      `).join("");
    }

    function rowHtml(r, i) {
      const flagCell = r.flag
        ? `<span class="flag-icon" title="AI tracking tag detected" aria-label="AI tracking tag detected">!</span>`
        : `<span class="cell-dash">—</span>`;
      const urlContent = r.flag ? highlightMatches(r.url, r.flaggedTags) : escapeHtml(r.url);
      const urlCell = `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="url-link">${urlContent}</a>`;
      return `
        <tr data-row="${i}">
          <td class="col-text" title="${escapeHtml(r.visibleText || "")}">${r.visibleText ? escapeHtml(r.visibleText) : '<span class="empty">—</span>'}</td>
          <td class="col-url">${urlCell}</td>
          <td class="col-flag">${flagCell}</td>
          <td class="col-status" data-status-cell="${i}">${statusBadge(r.status)}</td>
        </tr>
      `;
    }

    function renderTable() {
      let visible = results.map((r, i) => ({ r, i }));

      if (activeFilter === "flagged") visible = visible.filter(({ r }) => r.flag);
      if (activeFilter === "bad")     visible = visible.filter(({ r }) => r.status === "unreachable" || r.status === "timeout");

      if (sortCol === "flag") {
        visible.sort(({ r: a }, { r: b }) => {
          const diff = (b.flag ? 1 : 0) - (a.flag ? 1 : 0);
          return sortDir === "asc" ? diff : -diff;
        });
      }
      if (sortCol === "status") {
        const order = { unreachable: 0, timeout: 1, checking: 2, pending: 3, reachable: 4 };
        visible.sort(({ r: a }, { r: b }) => {
          const diff = (order[a.status] ?? 5) - (order[b.status] ?? 5);
          return sortDir === "asc" ? diff : -diff;
        });
      }

      const tbody = root.querySelector("tbody");
      if (tbody) tbody.innerHTML = visible.map(({ r, i }) => rowHtml(r, i)).join("");

      const indicator = $("[data-filter-indicator]", root);
      if (indicator) {
        if (activeFilter) {
          indicator.textContent = `Showing ${visible.length} of ${results.length}`;
          indicator.hidden = false;
        } else {
          indicator.hidden = true;
        }
      }

      root.querySelectorAll("[data-sort-col]").forEach(th => {
        const icon = th.querySelector(".sort-icon");
        const isActive = th.dataset.sortCol === sortCol;
        if (icon) icon.textContent = isActive ? (sortDir === "asc" ? " ↑" : " ↓") : "";
        th.classList.toggle("col-sort-active", isActive);
      });

      root.querySelectorAll("[data-filter]").forEach(btn => {
        btn.classList.toggle("pill-active", btn.dataset.filter === activeFilter);
      });
    }

    function updateRow(i) {
      const cell = root.querySelector(`[data-status-cell="${i}"]`);
      if (cell) cell.innerHTML = statusBadge(results[i].status);
    }

    function updatePills() {
      const bad     = results.filter(r => r.status === "unreachable" || r.status === "timeout").length;
      const flagged = results.filter(r => r.flag).length;
      const pBad     = $("[data-filter='bad']",     root);
      const pFlagged = $("[data-filter='flagged']", root);
      if (pBad)     { pBad.textContent     = `${bad} unreachable`;  pBad.hidden     = bad === 0     && activeFilter !== "bad"; }
      if (pFlagged) { pFlagged.textContent = `${flagged} AI flagged`; pFlagged.hidden = flagged === 0 && activeFilter !== "flagged"; }
    }

    function bindHandlers() {
      const detailsEl = $("[data-tags-details]", root);
      const tagInput  = $("[data-tag-input]",   root);
      const addTagBtn = $("[data-add-tag]",     root);
      const tagsList  = $("[data-tags-list]",   root);

      detailsEl.addEventListener("toggle", () => { tagsExpanded = detailsEl.open; });

      addTagBtn.addEventListener("click", addTag);
      tagInput.addEventListener("keydown", e => { if (e.key === "Enter") addTag(); });
      tagsList.addEventListener("click", e => {
        const btn = e.target.closest("button[data-tag-index]");
        if (!btn) return;
        tags.splice(Number(btn.dataset.tagIndex), 1);
        renderTags();
      });

      function addTag() {
        const v = tagInput.value.trim();
        if (v && !tags.includes(v)) { tags.push(v); renderTags(); }
        tagInput.value = "";
        tagInput.focus();
      }

      if (!results.length) return;

      root.addEventListener("click", e => {
        const filterBtn = e.target.closest("[data-filter]");
        if (filterBtn) {
          const f = filterBtn.dataset.filter;
          activeFilter = activeFilter === f ? null : f;
          renderTable();
          return;
        }

        const sortTh = e.target.closest("[data-sort-col]");
        if (sortTh) {
          const col = sortTh.dataset.sortCol;
          if (sortCol === col) {
            if (sortDir === "asc") { sortDir = "desc"; }
            else { sortCol = null; sortDir = "asc"; }
          } else {
            sortCol = col;
            sortDir = "asc";
          }
          renderTable();
          return;
        }

        if (!e.target.closest(".export-wrap")) {
          const menu = $("[data-export-menu]", root);
          if (menu) menu.hidden = true;
        }
      });

      const exportToggle = $("[data-export-toggle]", root);
      const exportMenu   = $("[data-export-menu]",   root);

      exportToggle.addEventListener("click", e => {
        e.stopPropagation();
        exportMenu.hidden = !exportMenu.hidden;
      });

      exportMenu.addEventListener("click", e => {
        const btn = e.target.closest("[data-export]");
        if (!btn) return;
        exportMenu.hidden = true;
        const slug = sourceLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
        if (btn.dataset.export === "copy-csv") {
          copyWithFeedback(exportToggle, () => toIndicatorsCSV(results));
        } else {
          downloadCSV(toIndicatorsCSV(results), `${slug || "results"}.csv`);
        }
      });
    }

    async function runLinkCheck() {
      results.forEach((r, i) => {
        if (r.status === "pending") {
          results[i].status = "checking";
          updateRow(i);
        }
      });

      let idx = 0;
      async function worker() {
        while (idx < results.length) {
          const i = idx++;
          results[i].status = await checkUrl(results[i].url);
          updateRow(i);
          updatePills();
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, results.length) }, worker));

      if (sessionId) {
        ns.history.update(sessionId, { results: results.map(r => ({ ...r })) });
      }
    }

    // Called by the rail whenever the active document (file or pasted text)
    // changes. `links` is the raw extracted list; this module applies tag
    // flags and kicks off reachability checks.
    function setLinks(links, label) {
      sourceLabel = label;
      results = applyTags(links, tags);
      sessionId = results.length ? `session-${Date.now()}` : null;
      activeFilter = null;
      sortCol = null;
      sortDir = "asc";

      if (results.length) {
        ns.history.add({
          id: sessionId,
          timestamp: Date.now(),
          sourceLabel,
          inputType: "file",
          tags: [...tags],
          results: results.map(r => ({ ...r })),
        });
      }

      render();
      if (results.length) runLinkCheck();
    }

    function reset() {
      results = [];
      sourceLabel = "";
      sessionId = null;
      activeFilter = null;
      sortCol = null;
      render();
    }

    function restoreSession(s) {
      tags = s.tags ? [...s.tags] : [...DEFAULT_TAGS];
      results = s.results;
      sourceLabel = s.sourceLabel;
      sessionId = s.id;
      activeFilter = null;
      sortCol = null;
      sortDir = "asc";
      render();
    }

    return { setLinks, reset, restoreSession };
  };
})();
