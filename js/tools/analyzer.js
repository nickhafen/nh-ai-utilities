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
    if (tag === "br") {
      frag.appendChild(document.createTextNode("\n"));
      return;
    }
    if (tag === "a") {
      const href = cleanUrl(node.getAttribute("href") || "");
      const label = node.textContent || href;
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = label;
        a.tabIndex = -1;
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
              <div class="panel-body">
                <div class="drop-bar" data-drop-area>
                  <span class="drop-icon">DOCX</span>
                  <span class="primary-text">Drop a .docx file here or click to browse</span>
                </div>
                <input type="file" accept=".docx" data-file-input hidden>
                <div
                  class="rich-input"
                  data-paste-area
                  contenteditable="true"
                  role="textbox"
                  aria-multiline="true"
                  data-placeholder="Or paste text here…"
                ></div>
              </div>
              <div class="panel-footer">
                <button class="btn btn-primary" data-analyze-paste>Analyze</button>
                <button class="btn btn-subtle" data-clear-paste>Clear</button>
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
        const dropArea   = $("[data-drop-area]",    root);
        const fileInput  = $("[data-file-input]",   root);
        const pasteArea  = $("[data-paste-area]",   root);
        const analyzeBtn = $("[data-analyze-paste]", root);
        const clearBtn   = $("[data-clear-paste]",  root);
        const toggleBtn  = $("[data-toggle-tags]",  root);
        const tagInput   = $("[data-tag-input]",    root);
        const addTagBtn  = $("[data-add-tag]",      root);
        const tagsList   = $("[data-tags-list]",    root);

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
          if (!links.length) {
            pasteArea.focus();
            return;
          }
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
        checkingLinks = true; // pre-set so button renders as disabled immediately

        ns.history.add({
          id: sessionId,
          timestamp: Date.now(),
          sourceLabel,
          inputType: type,
          tags: [...tags],
          results: results.map(r => ({ ...r })),
        });

        renderResults();
        runLinkCheck(); // start automatically
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
              <div><dt>Destination URL</dt><dd>The full destination URL.</dd></div>
              <div><dt>AI Flag</dt><dd>Flagged if the URL contains a known AI platform tracking tag (e.g. <code>utm_source=chatgpt.com</code>). Customize the tag list above.</dd></div>
              <div><dt>Status</dt><dd>Whether the URL responded when checked. <em>Reachable</em> means a server responded — not that the page exists (a 404 still shows as Reachable). Some legitimate links redirected by services like LinkedIn or Google may also show as Unreachable.</dd></div>
            </dl>

            <section class="panel results-panel">
              <div class="panel-header">
                <div class="panel-actions">
                  <span class="count-pill">${results.length} link${results.length === 1 ? "" : "s"}</span>
                  <span class="count-pill count-pill-warn" data-pill-flagged ${flagged ? "" : "hidden"}>${flagged} AI flagged</span>
                  <span class="count-pill count-pill-bad" data-pill-bad ${bad ? "" : "hidden"}>${bad} unreachable</span>
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
                      <th class="col-flag">AI Flag</th>
                      <th class="col-status">Status</th>
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
        const urlCell = r.flag
          ? highlightMatches(r.url, r.flaggedTags)
          : escapeHtml(r.url);
        return `
          <tr data-row="${i}">
            <td class="col-text">${r.visibleText ? escapeHtml(r.visibleText) : '<span class="empty">—</span>'}</td>
            <td class="col-url">${urlCell}</td>
            <td class="col-flag">${flagCell}</td>
            <td class="col-status" data-status-cell="${i}">${statusBadge(r.status)}</td>
          </tr>
        `;
      }

      function updateRow(i) {
        const cell = root.querySelector(`[data-status-cell="${i}"]`);
        if (cell) cell.innerHTML = statusBadge(results[i].status);
      }

      function updatePills() {
        const bad = results.filter(r => r.status === "unreachable" || r.status === "timeout").length;
        const flagged = results.filter(r => r.flag).length;
        const pBad = $("[data-pill-bad]", root);
        const pFlagged = $("[data-pill-flagged]", root);
        if (pBad) { pBad.textContent = `${bad} unreachable`; pBad.hidden = bad === 0; }
        if (pFlagged) { pFlagged.textContent = `${flagged} AI flagged`; pFlagged.hidden = flagged === 0; }
      }

      function bindResultHandlers() {
        $("[data-new-analysis]", root).addEventListener("click", () => {
          results = [];
          sourceLabel = "";
          sessionId = null;
          checkingLinks = false;
          renderInput();
        });

        $("[data-copy-urls]", root).addEventListener("click", async (e) => {
          await copyText(results.map(r => r.url).join("\n"));
          const btn = e.currentTarget;
          const orig = btn.textContent;
          btn.textContent = "Copied!";
          btn.disabled = true;
          setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
        });

        const exportToggle = $("[data-export-toggle]", root);
        const exportMenu   = $("[data-export-menu]",   root);

        exportToggle.addEventListener("click", () => {
          exportMenu.hidden = !exportMenu.hidden;
        });

        exportMenu.addEventListener("click", e => {
          const btn = e.target.closest("[data-export]");
          if (!btn) return;
          exportMenu.hidden = true;
          const csv = toCSV(results);
          const slug = sourceLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
          if (btn.dataset.export === "copy-csv") {
            copyText(csv);
          } else {
            downloadCSV(csv, `${slug || "results"}.csv`);
          }
        });

        // Close export menu when clicking elsewhere in the tool
        root.addEventListener("click", e => {
          if (!e.target.closest(".export-wrap")) exportMenu.hidden = true;
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
