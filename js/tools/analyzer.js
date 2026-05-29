(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml, extractUrls, cleanUrl, copyText, highlightMatches } = ns;

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

  // ── Paste-area helpers (safe rich-text insertion) ─────────────────────────

  const BLOCK = new Set([
    "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "section", "article", "header", "footer",
    "main", "nav", "aside", "figure", "figcaption", "address",
    "ol", "ul", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  ]);

  function sanitizeNode(node, frag) {
    if (node.nodeType === Node.TEXT_NODE) {
      frag.appendChild(document.createTextNode(node.nodeValue));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") { frag.appendChild(document.createTextNode("\n")); return; }
    if (tag === "a") {
      const href = cleanUrl(node.getAttribute("href") || "");
      const label = node.textContent || href;
      if (href) {
        const a = document.createElement("a");
        a.href = href; a.textContent = label; a.tabIndex = -1;
        frag.appendChild(a);
      } else {
        frag.appendChild(document.createTextNode(label));
      }
      return;
    }
    node.childNodes.forEach(c => sanitizeNode(c, frag));
    if (BLOCK.has(tag)) {
      if (!frag.lastChild || frag.lastChild.nodeValue !== "\n")
        frag.appendChild(document.createTextNode("\n"));
    }
  }

  function htmlToFragment(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const frag = document.createDocumentFragment();
    doc.body.childNodes.forEach(n => sanitizeNode(n, frag));
    return frag;
  }

  function insertAtCursor(editor, frag) {
    editor.focus();
    const marker = document.createTextNode("");
    frag.appendChild(marker);
    const sel = window.getSelection();
    let range = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(frag);
    range.setStartAfter(marker);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    marker.remove();
  }

  // ── Link extraction from pasted content ──────────────────────────────────

  function extractFromPaste(html, plain) {
    const seen = new Set();
    const links = [];
    function add(visibleText, url) {
      const clean = cleanUrl(url);
      if (!clean || clean.startsWith("#") || seen.has(clean)) return;
      seen.add(clean);
      links.push({ visibleText: visibleText.trim(), url: clean });
    }
    if (html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("a[href]").forEach(a => {
        const href = cleanUrl(a.getAttribute("href") || "");
        if (href) add(a.textContent, href);
      });
      for (const u of extractUrls(doc.body.textContent || "")) add(u, u);
    }
    for (const u of extractUrls(plain || "")) add(u, u);
    return links;
  }

  function extractFromEditor(editor) {
    return extractFromPaste(editor.innerHTML, editor.textContent);
  }

  // ── Tag matching ──────────────────────────────────────────────────────────

  function applyTags(links, tags) {
    return links.map(({ visibleText, url }) => {
      const flaggedTags = tags.filter(t => url.toLowerCase().includes(t.toLowerCase()));
      return { visibleText, url, flag: flaggedTags.length > 0, flaggedTags, status: "pending" };
    });
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  function toCSV(rows) {
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

  // ── Source label for paste input ──────────────────────────────────────────

  function pasteLabel(editor) {
    const first = (editor.textContent || "").trim().split("\n")[0].trim();
    const preview = first.slice(0, 60);
    return `Pasted text: "${preview}${preview.length < first.length ? "…" : ""}"`;
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

  // ── Tool registration ─────────────────────────────────────────────────────

  ns.registerTool({
    id: "analyzer",
    name: "Document Tools",
    render(root) {
      let tags = [...DEFAULT_TAGS];
      let results = [];
      let sourceLabel = "";
      let sessionId = null;
      let checkingLinks = false;
      let tagsExpanded = false;
      let activeFilter = null; // null | "flagged" | "bad"
      let sortCol = null;      // null | "flag" | "status"
      let sortDir = "asc";

      // Restore from history if navigated here with a pending session
      if (ns.pendingSession) {
        const s = ns.pendingSession;
        ns.pendingSession = null;
        tags = s.tags ? [...s.tags] : [...DEFAULT_TAGS];
        results = s.results;
        sourceLabel = s.sourceLabel;
        sessionId = s.id;
        renderResults();
        return;
      }

      renderInput();

      // ── Input phase ─────────────────────────────────────────────────────

      function renderInput() {
        root.innerHTML = `
          <div class="tool-view">
            <section class="panel input-panel">
              <div class="panel-header">
                <span class="panel-title">Document</span>
              </div>
              <div class="upload-section" data-drop-area>
                <div class="drop-icon">DOCX</div>
                <p class="primary-text">Drop a .docx file here or click to browse</p>
              </div>
              <input type="file" accept=".docx" data-file-input hidden>
              <div class="input-section-divider"><span>or</span></div>
              <div class="paste-section">
                <p class="paste-label">Paste text</p>
                <div
                  class="rich-input"
                  data-paste-area
                  contenteditable="true"
                  role="textbox"
                  aria-multiline="true"
                  data-placeholder="Paste text here…"
                ></div>
                <div class="paste-actions">
                  <button class="btn btn-primary" data-analyze-paste>Analyze</button>
                  <button class="btn btn-subtle" data-clear-paste>Clear</button>
                </div>
              </div>
            </section>

            <div class="configure-row">
              <button class="btn btn-subtle configure-toggle" data-toggle-tags aria-expanded="false">
                <span class="configure-icon" aria-hidden="true">▶</span> Configure AI URL tags
              </button>
              <div class="configure-body" data-tags-body hidden>
                <p class="hint" style="margin-bottom:0.75rem">URLs containing any of these strings will be flagged in the AI Flag column.</p>
                <div class="tags-row" data-tags-list></div>
                <div class="add-row">
                  <input class="text-input" data-tag-input type="text" placeholder="Add a tag…">
                  <button class="btn btn-secondary" data-add-tag>Add</button>
                </div>
              </div>
            </div>

            <p class="storage-note">
              🔒 <strong>Privacy:</strong> Nothing is uploaded to the internet — all analysis runs in your browser.
              Results are saved to this browser's local storage on this device only.
              They are not synced across devices or browsers, and will be cleared if you clear your browser's site data for this page.
            </p>
          </div>
        `;

        renderTags();
        bindInputHandlers();
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

      function bindInputHandlers() {
        const dropArea   = $("[data-drop-area]",     root);
        const fileInput  = $("[data-file-input]",    root);
        const pasteArea  = $("[data-paste-area]",    root);
        const analyzeBtn = $("[data-analyze-paste]", root);
        const clearBtn   = $("[data-clear-paste]",   root);
        const toggleBtn  = $("[data-toggle-tags]",   root);
        const tagInput   = $("[data-tag-input]",     root);
        const addTagBtn  = $("[data-add-tag]",       root);
        const tagsList   = $("[data-tags-list]",     root);

        // File upload
        dropArea.addEventListener("click", () => fileInput.click());
        dropArea.addEventListener("dragover", e => { e.preventDefault(); dropArea.classList.add("drag-over"); });
        dropArea.addEventListener("dragleave", () => dropArea.classList.remove("drag-over"));
        dropArea.addEventListener("drop", e => {
          e.preventDefault();
          dropArea.classList.remove("drag-over");
          if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener("change", e => {
          if (e.target.files[0]) processFile(e.target.files[0]);
        });

        // Paste area
        pasteArea.addEventListener("paste", e => {
          e.preventDefault();
          const cb = e.clipboardData;
          const html = cb.getData("text/html");
          const plain = cb.getData("text/plain");
          const frag = html
            ? htmlToFragment(html)
            : (() => { const f = document.createDocumentFragment(); f.appendChild(document.createTextNode(plain)); return f; })();
          insertAtCursor(pasteArea, frag);
        });

        analyzeBtn.addEventListener("click", () => {
          const links = extractFromEditor(pasteArea);
          if (!links.length) { pasteArea.focus(); return; }
          processLinks(links, pasteLabel(pasteArea), "paste");
        });

        clearBtn.addEventListener("click", () => {
          pasteArea.innerHTML = "";
          pasteArea.focus();
        });

        // Tags toggle
        toggleBtn.addEventListener("click", () => {
          tagsExpanded = !tagsExpanded;
          const body = $("[data-tags-body]", root);
          const icon = $(".configure-icon", toggleBtn);
          body.hidden = !tagsExpanded;
          toggleBtn.setAttribute("aria-expanded", String(tagsExpanded));
          if (icon) icon.textContent = tagsExpanded ? "▾" : "▶";
        });

        // Tag management
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
      }

      // ── File processing ─────────────────────────────────────────────────

      async function processFile(file) {
        if (!file.name.toLowerCase().endsWith(".docx")) {
          alert("Please select a .docx file.");
          return;
        }
        if (!window.JSZip) {
          alert("The document reader did not load. Check your connection and refresh.");
          return;
        }
        try {
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          const links = await ns.extractDocxLinks(zip);
          processLinks(links, file.name, "file");
        } catch {
          alert("Could not read the file. Make sure it is a valid .docx.");
        }
      }

      function processLinks(links, label, type) {
        sourceLabel = label;
        results = applyTags(links, tags);
        sessionId = `session-${Date.now()}`;
        checkingLinks = true;
        activeFilter = null;
        sortCol = null;
        sortDir = "asc";

        ns.history.add({
          id: sessionId,
          timestamp: Date.now(),
          sourceLabel,
          inputType: type,
          tags: [...tags],
          results: results.map(r => ({ ...r })),
        });

        renderResults();
        runLinkCheck();
      }

      // ── Results phase ───────────────────────────────────────────────────

      function renderResults() {
        const flagged = results.filter(r => r.flag).length;
        const bad = results.filter(r => r.status === "unreachable" || r.status === "timeout").length;

        root.innerHTML = `
          <div class="tool-view">
            <div class="source-bar">
              <div class="source-label">
                <span aria-hidden="true">📄</span>
                <span title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</span>
              </div>
              <button class="btn btn-secondary" data-new-analysis>New Document</button>
            </div>

            <dl class="column-guide">
              <div><dt>Visible Text</dt><dd>The anchor text of the link as it appears in the document.</dd></div>
              <div><dt>Destination URL</dt><dd>The full destination URL. Click any link to open it in a new tab.</dd></div>
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
          </div>
        `;

        bindResultHandlers();
      }

      function rowHtml(r, i) {
        const flagCell = r.flag
          ? `<span class="flag-icon" title="AI tracking tag detected" aria-label="AI tracking tag detected">!</span>`
          : `<span class="cell-dash">—</span>`;
        const urlContent = r.flag ? highlightMatches(r.url, r.flaggedTags) : escapeHtml(r.url);
        const urlCell = `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="url-link">${urlContent}</a>`;
        return `
          <tr data-row="${i}">
            <td class="col-text">${r.visibleText ? escapeHtml(r.visibleText) : '<span class="empty">—</span>'}</td>
            <td class="col-url">${urlCell}</td>
            <td class="col-flag">${flagCell}</td>
            <td class="col-status" data-status-cell="${i}">${statusBadge(r.status)}</td>
          </tr>
        `;
      }

      // ── Table rendering (with filter + sort) ─────────────────────────────

      function renderTable() {
        // Build an indexed list so we preserve original indices for updateRow()
        let visible = results.map((r, i) => ({ r, i }));

        if (activeFilter === "flagged") visible = visible.filter(({ r }) => r.flag);
        if (activeFilter === "bad")     visible = visible.filter(({ r }) => r.status === "unreachable" || r.status === "timeout");

        if (sortCol === "flag") {
          visible.sort(({ r: a }, { r: b }) => {
            const diff = (b.flag ? 1 : 0) - (a.flag ? 1 : 0); // flagged first
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

        // Filter indicator
        const indicator = $("[data-filter-indicator]", root);
        if (indicator) {
          if (activeFilter) {
            indicator.textContent = `Showing ${visible.length} of ${results.length}`;
            indicator.hidden = false;
          } else {
            indicator.hidden = true;
          }
        }

        // Sort icons + active class
        root.querySelectorAll("[data-sort-col]").forEach(th => {
          const icon = th.querySelector(".sort-icon");
          const isActive = th.dataset.sortCol === sortCol;
          if (icon) icon.textContent = isActive ? (sortDir === "asc" ? " ↑" : " ↓") : "";
          th.classList.toggle("col-sort-active", isActive);
        });

        // Active filter pill styling
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

      // ── Result handlers ──────────────────────────────────────────────────

      function bindResultHandlers() {
        $("[data-new-analysis]", root).addEventListener("click", () => {
          results = [];
          sourceLabel = "";
          sessionId = null;
          checkingLinks = false;
          activeFilter = null;
          sortCol = null;
          renderInput();
        });

        // Copy URLs with visual feedback
        $("[data-copy-urls]", root).addEventListener("click", e => {
          copyWithFeedback(e.currentTarget, () => results.map(r => r.url).join("\n"));
        });

        // Filter pills
        root.addEventListener("click", e => {
          const filterBtn = e.target.closest("[data-filter]");
          if (filterBtn) {
            const f = filterBtn.dataset.filter;
            activeFilter = activeFilter === f ? null : f; // toggle
            renderTable();
            return;
          }

          // Sort headers
          const sortTh = e.target.closest("[data-sort-col]");
          if (sortTh) {
            const col = sortTh.dataset.sortCol;
            if (sortCol === col) {
              if (sortDir === "asc") { sortDir = "desc"; }
              else { sortCol = null; sortDir = "asc"; } // third click clears
            } else {
              sortCol = col;
              sortDir = "asc";
            }
            renderTable();
            return;
          }

          // Close export menu
          if (!e.target.closest(".export-wrap")) {
            const menu = $("[data-export-menu]", root);
            if (menu) menu.hidden = true;
          }
        });

        // Export
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
            copyWithFeedback(exportToggle, () => toCSV(results));
          } else {
            downloadCSV(toCSV(results), `${slug || "results"}.csv`);
          }
        });
      }

      // ── Link checking ───────────────────────────────────────────────────

      async function runLinkCheck() {
        checkingLinks = true;

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

        checkingLinks = false;

        if (sessionId) {
          ns.history.update(sessionId, { results: results.map(r => ({ ...r })) });
        }
      }
    },
  });
})();
