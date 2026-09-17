// Batch Download workflow, mounted by the Document Tools rail
// (js/tools/document-tools.js). It turns the document's links into a
// reviewed download list and exports a zip: files.csv (the only user data),
// plus the fixed script, runner and README from
// js/shared/batch-download-script.js. A browser page can't fetch or rename
// files from other sites, so the downloading happens in that local script.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, $$, escapeHtml } = ns;
  const F = ns.filenames;

  const NOTICE_KEY = "ai-utilities-batch-notice-collapsed";
  const SESSION_VERSION = 1;
  const AUTOSAVE_MS = 1000;
  // Stand-in base so relative links can be named before a Base URL is known.
  const PLACEHOLDER_BASE = "https://base-url-needed.invalid/";

  function readNoticeCollapsed() {
    try { return localStorage.getItem(NOTICE_KEY) === "1"; } catch { return false; }
  }

  function writeNoticeCollapsed(collapsed) {
    try { localStorage.setItem(NOTICE_KEY, collapsed ? "1" : "0"); } catch { /* always expanded without storage */ }
  }

  function noticeHtml(open) {
    const types = F.ALLOWED_EXTS.join(" ");
    return `
      <details class="converter-notes bd-notice" data-bd-notice ${open ? "open" : ""}>
        <summary>Before you use Batch Download: how it works, limitations and risks</summary>
        <div class="converter-notes-body">
          <p><strong>How it works:</strong> This page builds a download list; a small Windows script on your computer does the downloading. Nothing is uploaded.</p>
          <p><strong>Trust:</strong> You'll run a PowerShell script from this site. Read it with <em>View script</em> first, and check its fingerprint against the one on GitHub (instructions are in the bundle's README.txt).</p>
          <p><strong>Windows only.</strong> When you double-click the runner, Windows will probably show an &ldquo;Open File &ndash; Security Warning&rdquo;. That's expected for files from the internet.</p>
          <div>
            <strong>What it can't do:</strong>
            <ul class="bd-list">
              <li>Files behind a login, paywall or CAPTCHA fail. The script doesn't use your browser's sign-in.</li>
              <li>Links added by JavaScript, or hidden behind &ldquo;load more&rdquo; or pagination, may be missing. Paste the page instead of saving it, or scroll everything into view first.</li>
              <li>Saved <code>.html</code> pages may need the Base URL filled in.</li>
              <li>Link text in PDFs isn't available, so names come from the URL.</li>
              <li>Links written without <code>http</code> (e.g. <code>oas.org/&hellip;</code>) aren't detected; <code>www.</code> links are.</li>
              <li>Only these file types can be downloaded: <code>${escapeHtml(types)}</code>.</li>
            </ul>
          </div>
          <p><strong>Third-party code:</strong> This site loads some libraries from public CDNs at runtime. Pinned libraries are integrity-checked; a few (tokenizer, PDF reader, OCR) can't be. See the README's <a href="https://github.com/nickhafen/nh-ai-utilities#security--third-party-code" target="_blank" rel="noopener noreferrer">Security section</a>.</p>
          <p><strong>You are responsible</strong> for having the right to download the linked files.</p>
        </div>
      </details>`;
  }

  function slugOf(label) {
    return String(label || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  ns.mountBatchDownloadWorkflow = function mountBatchDownloadWorkflow(root) {
    let rows = [];
    let sourceLabel = "";
    let baseUrl = "";      // as typed
    let show = "docs";     // "docs" | "all"
    let nameFrom = "text"; // "text" | "url"
    let extractionError = "";
    let restoreFailed = false;
    let loaded = false;    // a document (or restored session) is active
    let sessionId = null;
    let exportCount = 0;
    let lastExportedAt = null;
    let autosaveTimer = null;
    let historyMessage = "";
    let exportMessage = "";
    let prefer = "pdf";    // "pdf" | "word" | "all": which format to keep when a file comes in several
    let formatGroupCount = 0;
    let search = "";
    let lastClicked = null; // row index of the last checkbox click, for Shift+click ranges
    let scriptOpen = false;
    let noticeOpen = !readNoticeCollapsed();

    render();

    // ── Row model ───────────────────────────────────────────────────────────

    const cleanBase = () => ns.cleanUrl(baseUrl);

    function resolveRow(row) {
      row.url = row.relative ? ns.resolveUrl(row.rawHref, cleanBase()) : row.url;
    }

    // URL used for naming: the resolved URL, or the relative href against a
    // placeholder so its filename and extension can still be suggested.
    function namingUrl(row) {
      if (row.url) return row.url;
      try { return new URL(row.rawHref, PLACEHOLDER_BASE).href; } catch { return PLACEHOLDER_BASE; }
    }

    // A link with no usable text (e.g. a Word icon next to the PDF link) can
    // borrow the text of the same file in another format.
    function labelFor(row) {
      return row.borrowedText && !F.hasUsableLabel(row.visibleText, namingUrl(row))
        ? row.borrowedText
        : row.visibleText;
    }

    function applySuggestion(row) {
      const s = F.suggest(labelFor(row), namingUrl(row), { nameFrom, n: row.n });
      if (!row.extEdited) row.ext = s.ext;
      if (!row.edited) {
        // Re-fit the suggestion if the user picked a different extension.
        const refit = row.extEdited && row.ext !== s.ext
          ? F.sanitizeName(s.filename, { maxBase: F.MAX_LENGTH - (row.ext === "auto" ? 0 : row.ext.length + 1) })
          : { name: s.filename, notes: s.notes };
        row.filename = refit.name;
        row.notes = refit.notes;
      }
      row.kind = s.kind;
    }

    function makeRow(link, i) {
      const relative = !link.url;
      const row = {
        n: i + 1,
        rawHref: link.rawHref || link.url,
        url: link.url || "",
        relative,
        visibleText: link.visibleText || "",
        borrowedText: "",
        borrowedFrom: "",
        group: null,
        filename: "",
        ext: "auto",
        notes: [],
        kind: "unknown",
        checked: false,
        edited: false,
        extEdited: false,
      };
      resolveRow(row);
      applySuggestion(row);
      row.checked = row.kind === "document";
      return row;
    }

    const FAMILY = { pdf: "pdf", doc: "word", docx: "word", rtf: "word", odt: "word" };

    // Finds files offered in more than one format (same URL apart from the
    // extension), and lets text-less links borrow a sibling's link text.
    // Re-suggests names that change as a result (unless the user edited them).
    function computeGroups() {
      const byKey = new Map();
      for (const r of rows) {
        r.group = null;
        if (r.kind !== "document") continue;
        const key = F.formatGroupKey(namingUrl(r));
        if (!key) continue;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(r);
      }
      formatGroupCount = 0;
      for (const members of byKey.values()) {
        if (new Set(members.map((m) => m.ext)).size < 2) continue;
        formatGroupCount++;
        const donor = members.find((m) => F.hasUsableLabel(m.visibleText, namingUrl(m)));
        for (const m of members) {
          m.group = members;
          const borrowed = donor && donor !== m ? donor.visibleText : "";
          if (borrowed !== m.borrowedText) {
            m.borrowedText = borrowed;
            m.borrowedFrom = borrowed ? donor.ext : "";
            if (!m.edited) applySuggestion(m);
          }
        }
      }
    }

    // Checks the preferred format in each multi-format group (all formats for
    // "all"). Groups without the preferred format are left alone.
    function applyPreference() {
      const seen = new Set();
      for (const r of rows) {
        if (!r.group || seen.has(r.group)) continue;
        seen.add(r.group);
        if (prefer === "all") {
          r.group.forEach((m) => { m.checked = true; });
        } else if (r.group.some((m) => FAMILY[m.ext] === prefer)) {
          r.group.forEach((m) => { m.checked = FAMILY[m.ext] === prefer; });
        }
      }
    }

    function isVisible(row) {
      return show === "all" || row.kind === "document" || row.checked;
    }

    function matchesSearch(row) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return true;
      const hay = [row.filename, `.${row.ext}`, row.visibleText, row.borrowedText, row.url || row.rawHref]
        .join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    }

    // Rows in the table that the current search also matches.
    function isShown(row) {
      return isVisible(row) && matchesSearch(row);
    }

    function setChecked(i, value) {
      rows[i].checked = value;
      const box = $(`[data-bd-check="${i}"]`, root);
      if (box) box.checked = value;
    }

    // Validation for every row; duplicates are counted among checked rows.
    function validateAll() {
      const counts = new Map();
      for (const r of rows) {
        if (!r.checked) continue;
        const key = F.duplicateKey(r.filename, r.ext);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return rows.map((r) => F.validate({
        filename: r.filename,
        ext: r.ext,
        url: r.url,
        notes: r.edited ? [] : r.notes,
        duplicate: r.checked && counts.get(F.duplicateKey(r.filename, r.ext)) > 1,
        relative: r.relative && !r.url,
      }));
    }

    function summary(results) {
      const selected = rows.filter((r) => r.checked).length;
      const problems = rows.filter((r, i) => r.checked && results[i].errors.length).length;
      return { selected, problems };
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    function render() {
      if (!loaded) {
        root.innerHTML = `
          <div class="tool-view">
            ${noticeHtml(noticeOpen)}
            ${restoreFailed
              ? `<p class="converter-error" role="alert">This History entry couldn't be reopened. It may be from an older version of the tool.</p>`
              : `<div class="history-empty"><p>No links yet. Add a document on the left to build a download list.</p></div>`}
          </div>`;
        bindNotice();
        return;
      }

      if (!rows.length) {
        root.innerHTML = `
          <div class="tool-view">
            ${noticeHtml(noticeOpen)}
            ${extractionError ? `<p class="converter-error" role="alert">${escapeHtml(extractionError)}</p>` : ""}
            <div class="history-empty">
              <p>No links found in this document.</p>
              <p class="hint" style="margin-top:0.5rem">If you saved a web page, try copying the page (Ctrl+A, Ctrl+C) and pasting it instead.</p>
            </div>
          </div>`;
        bindNotice();
        return;
      }

      lastClicked = null;
      const visible = rows.map((r, i) => ({ r, i })).filter(({ r }) => isVisible(r));
      root.innerHTML = `
        <div class="tool-view">
          ${noticeHtml(noticeOpen)}
          <section class="panel results-panel bd-panel">
            <div class="panel-header bd-toolbar">
              <div class="bd-toolbar-row">
                <label class="bd-field bd-base">
                  <span>Base URL</span>
                  <input type="url" class="text-input" data-bd-base placeholder="https://example.org/page.html" autocomplete="off" spellcheck="false">
                </label>
                <label class="separator-label">Show
                  <select class="select-input" data-bd-show>
                    <option value="docs" ${show === "docs" ? "selected" : ""}>Documents only</option>
                    <option value="all" ${show === "all" ? "selected" : ""}>All links</option>
                  </select>
                </label>
                <label class="separator-label">Name from
                  <select class="select-input" data-bd-name-from>
                    <option value="text" ${nameFrom === "text" ? "selected" : ""}>Link text</option>
                    <option value="url" ${nameFrom === "url" ? "selected" : ""}>URL filename</option>
                  </select>
                </label>
                ${formatGroupCount ? `
                <label class="separator-label" title="Some files are offered in more than one format, for example a PDF with a Word copy next to it.">Same file in several formats
                  <select class="select-input" data-bd-prefer>
                    <option value="pdf" ${prefer === "pdf" ? "selected" : ""}>Keep PDF</option>
                    <option value="word" ${prefer === "word" ? "selected" : ""}>Keep Word</option>
                    <option value="all" ${prefer === "all" ? "selected" : ""}>Keep all</option>
                  </select>
                </label>` : ""}
              </div>
              <div class="bd-toolbar-row bd-filter-row">
                <input type="search" class="text-input bd-search" data-bd-search placeholder="Filter by name, link text or URL" aria-label="Filter rows" autocomplete="off" spellcheck="false">
                <button type="button" class="btn btn-secondary btn-sm" data-bd-check-shown="1">Check shown</button>
                <button type="button" class="btn btn-secondary btn-sm" data-bd-check-shown="0">Uncheck shown</button>
                <span class="hint" data-bd-shown></span>
              </div>
              <div class="bd-toolbar-row">
                <span class="hint">File types:</span>
                <span class="bd-chips" data-bd-chips role="group" aria-label="Check or uncheck shown rows by file type"></span>
                <span class="hint bd-tip">Tip: Shift+click checkboxes to select a range.</span>
              </div>
              <div class="bd-toolbar-row">
                <span class="count-pill" data-bd-counts></span>
                <span class="bd-spacer"></span>
                <button type="button" class="btn btn-secondary" data-bd-view-script aria-expanded="${scriptOpen}" aria-controls="bd-script-panel">${scriptOpen ? "Hide script" : "View script"}</button>
                <span class="bd-export-wrap" data-bd-export-wrap>
                  <button type="button" class="btn btn-primary" data-bd-export>Download bundle (.zip)</button>
                </span>
              </div>
            </div>
            <p class="bd-field-error" data-bd-base-error role="alert" hidden></p>
            <div id="bd-script-panel" class="bd-script" data-bd-script ${scriptOpen ? "" : "hidden"}>
              <p class="hint">This is the exact <code>download-files.ps1</code> in every bundle. <code>Run Download.cmd</code> just runs it: <code data-bd-runner></code></p>
              <pre data-bd-script-text></pre>
            </div>
            <div class="bd-alerts" data-bd-alerts role="alert"></div>
            ${visible.length ? tableHtml(visible) : ""}
          </section>
        </div>`;

      $("[data-bd-base]", root).value = baseUrl;
      $("[data-bd-search]", root).value = search;
      if (scriptOpen) fillScriptPanel();
      // Set input values as properties, never through HTML.
      for (const { r, i } of visible) {
        const input = $(`[data-bd-name="${i}"]`, root);
        if (input) input.value = r.filename;
        const select = $(`[data-bd-ext="${i}"]`, root);
        if (select) select.value = r.ext;
      }
      bindNotice();
      bindHandlers();
      refreshStatus();
    }

    function extOptions(current) {
      const exts = ["auto", ...F.ALLOWED_EXTS];
      if (!exts.includes(current)) exts.push(current);
      return exts.map((e) => `<option value="${escapeHtml(e)}">${e === "auto" ? "auto" : "." + escapeHtml(e)}</option>`).join("");
    }

    function tableHtml(visible) {
      return `
        <div class="table-wrap">
          <table class="bd-table">
            <thead>
              <tr>
                <th class="col-check"><input type="checkbox" data-bd-check-all aria-label="Include all shown rows"></th>
                <th class="bd-col-name">Filename</th>
                <th class="bd-col-ext">Ext</th>
                <th class="bd-col-url">URL</th>
                <th class="bd-col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              ${visible.map(({ r, i }) => `
                <tr data-bd-row="${i}">
                  <td class="col-check"><input type="checkbox" data-bd-check="${i}" ${r.checked ? "checked" : ""} aria-label="Include this file"></td>
                  <td class="bd-col-name">
                    <input type="text" class="text-input bd-name-input" data-bd-name="${i}" aria-label="Filename for row ${r.n}" autocomplete="off" spellcheck="false">
                    ${linkTextHtml(r)}
                  </td>
                  <td class="bd-col-ext">
                    <select class="select-input bd-ext-select" data-bd-ext="${i}" aria-label="File type for row ${r.n}">${extOptions(r.ext)}</select>
                  </td>
                  <td class="bd-col-url">${urlCellHtml(r)}</td>
                  <td class="bd-col-status" data-bd-status="${i}"></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>`;
    }

    function linkTextHtml(r) {
      const text = labelFor(r);
      if (!text || text === F.PDF_PLACEHOLDER) return "";
      const label = text === r.visibleText ? "Link text" : `Link text (from the .${escapeHtml(r.borrowedFrom)} version)`;
      return `<div class="bd-link-text" title="${escapeHtml(text)}">${label}: ${escapeHtml(text)}</div>`;
    }

    // r.url is always a cleaned http(s) URL, so it's safe as an href.
    function urlCellHtml(r) {
      return r.url
        ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="url-link">${escapeHtml(r.url)}</a>`
        : `<span class="bd-relative" title="Relative link: needs a Base URL">${escapeHtml(r.rawHref)}</span>`;
    }

    function statusHtml(result, i) {
      const r = rows[i];
      if (!r.checked && r.kind === "page") {
        return `<span class="hint">Web page, not a file. Not included.</span>`;
      }
      if (!result.errors.length && !result.warnings.length) {
        return `<span class="link-badge badge-reachable">Ready</span>`;
      }
      const fixable = result.errors.some((e) => e.fixable);
      return `
        <ul class="bd-messages">
          ${result.errors.map((e) => `<li class="bd-msg bd-msg-error">${escapeHtml(e.message)}</li>`).join("")}
          ${result.warnings.map((w) => `<li class="bd-msg bd-msg-warn">${escapeHtml(w.message)}</li>`).join("")}
        </ul>
        ${fixable ? `<button type="button" class="btn btn-secondary btn-sm" data-bd-fix="${i}">Fix automatically</button>` : ""}
        ${!r.checked && result.errors.length ? `<span class="hint">Unchecked rows aren't exported.</span>` : ""}`;
    }

    function problemsMessage(problems) {
      return problems === 1
        ? "Fix the highlighted row (or uncheck it) before downloading."
        : `Fix the ${problems} highlighted rows (or uncheck them) before downloading.`;
    }

    // Updates everything that depends on validation without re-rendering the
    // inputs, so typing never loses focus.
    function refreshStatus() {
      const results = validateAll();
      rows.forEach((r, i) => {
        const cell = $(`[data-bd-status="${i}"]`, root);
        if (!cell) return;
        cell.innerHTML = statusHtml(results[i], i);
        const tr = cell.closest("tr");
        tr.classList.toggle("bd-row-off", !r.checked);
        tr.classList.toggle("bd-row-error", r.checked && results[i].errors.length > 0);
        const input = $(`[data-bd-name="${i}"]`, root);
        const nameError = results[i].errors.some((e) => !["relative", "ext-blocked", "ext-invalid"].includes(e.code));
        if (input) {
          input.classList.toggle("input-error", r.checked && nameError);
          input.setAttribute("aria-invalid", String(r.checked && nameError));
        }
      });

      const { selected, problems } = summary(results);
      const counts = $("[data-bd-counts]", root);
      if (counts) counts.textContent = `${selected} selected · ${problems} problem${problems === 1 ? "" : "s"}`;

      const exportBtn = $("[data-bd-export]", root);
      if (exportBtn) {
        let reason = "";
        if (!selected) reason = "Check at least one row to build a download bundle.";
        else if (problems) reason = problemsMessage(problems);
        exportBtn.disabled = !!reason;
        $("[data-bd-export-wrap]", root).title = reason;
        exportBtn.dataset.reason = reason;
      }

      // Search filter: hide non-matching rows in place (the row being typed
      // in stays visible so it doesn't vanish mid-edit).
      const focused = document.activeElement;
      rows.forEach((r, i) => {
        const tr = $(`[data-bd-row="${i}"]`, root);
        if (tr && !tr.contains(focused)) tr.hidden = !matchesSearch(r);
      });
      const shown = rows.filter(isShown);
      const inTable = rows.filter(isVisible).length;
      const shownNote = $("[data-bd-shown]", root);
      if (shownNote) shownNote.textContent = search.trim() ? `Showing ${shown.length} of ${inTable}` : "";

      const checkAll = $("[data-bd-check-all]", root);
      if (checkAll) {
        const on = shown.filter((r) => r.checked).length;
        checkAll.checked = on > 0 && on === shown.length;
        checkAll.indeterminate = on > 0 && on < shown.length;
      }

      const chips = $("[data-bd-chips]", root);
      if (chips) {
        const types = new Map();
        for (const r of shown) {
          const t = types.get(r.ext) || { total: 0, on: 0 };
          t.total++;
          if (r.checked) t.on++;
          types.set(r.ext, t);
        }
        chips.innerHTML = [...types].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0])).map(([ext, t]) => {
          const pressed = t.on === t.total ? "true" : t.on ? "mixed" : "false";
          const name = ext === "auto" ? "unknown type" : `.${ext}`;
          const action = pressed === "true" ? "Uncheck" : "Check";
          return `<button type="button" class="bd-chip" data-bd-chip="${escapeHtml(ext)}" aria-pressed="${pressed}" title="${action} all shown ${escapeHtml(name)} rows">${escapeHtml(name)} <span>${t.on}/${t.total}</span></button>`;
        }).join("") || `<span class="hint">none shown</span>`;
      }

      refreshAlerts(selected, problems);
    }

    function refreshAlerts(selected, problems) {
      const box = $("[data-bd-alerts]", root);
      if (!box) return;
      const msgs = [];
      if (extractionError) msgs.push(["error", escapeHtml(extractionError)]);

      const unresolved = rows.filter((r) => r.relative && !r.url);
      if (unresolved.length && !cleanBase()) {
        const example = unresolved[0].rawHref.slice(0, 60);
        msgs.push(["warn", `${unresolved.length} link${unresolved.length === 1 ? " is" : "s are"} relative (e.g. <code>${escapeHtml(example)}</code>) and need${unresolved.length === 1 ? "s" : ""} the page's address. Enter it in <em>Base URL</em>.`]);
      }

      const docs = rows.filter((r) => r.kind === "document").length;
      if (show === "docs" && !docs && !rows.some((r) => r.checked)) {
        msgs.push(["info", `Found ${rows.length} link${rows.length === 1 ? "" : "s"}, but none point to a supported file type. Switch <em>Show</em> to <em>All links</em> to review them.`]);
      }

      if (formatGroupCount && prefer !== "all") {
        msgs.push(["info", `${formatGroupCount} file${formatGroupCount === 1 ? " is" : "s are"} offered in more than one format. Only the ${prefer === "pdf" ? "PDF" : "Word"} version is checked; change this with <em>Same file in several formats</em>.`]);
      }

      if (!selected && rows.some(isVisible)) msgs.push(["info", "Check at least one row to build a download bundle."]);
      else if (problems) msgs.push(["error", problemsMessage(problems)]);

      if (exportMessage) msgs.push(["error", escapeHtml(exportMessage)]);
      if (historyMessage) msgs.push(["warn", escapeHtml(historyMessage)]);

      box.innerHTML = msgs.map(([kind, html]) => `<p class="bd-alert bd-alert-${kind}">${html}</p>`).join("");
      box.hidden = !msgs.length;

      const baseError = $("[data-bd-base-error]", root);
      if (baseError) {
        const bad = baseUrl.trim() && !cleanBase();
        baseError.textContent = bad ? "That isn't a valid web address. It should start with https://." : "";
        baseError.hidden = !bad;
        $("[data-bd-base]", root).classList.toggle("input-error", !!bad);
      }
    }

    function fillScriptPanel() {
      $("[data-bd-script-text]", root).textContent = ns.batchDownloadBundle.SCRIPT_PS1;
      $("[data-bd-runner]", root).textContent = ns.batchDownloadBundle.RUNNER_CMD.split("\n").find((l) => l.startsWith("powershell")) || "";
    }

    // ── Events ──────────────────────────────────────────────────────────────

    function bindNotice() {
      const details = $("[data-bd-notice]", root);
      details.addEventListener("toggle", () => {
        noticeOpen = details.open;
        writeNoticeCollapsed(!details.open);
      });
    }

    function changed() {
      exportMessage = "";
      refreshStatus();
      scheduleAutosave();
    }

    function bindHandlers() {
      const baseInput = $("[data-bd-base]", root);
      baseInput.addEventListener("input", () => {
        baseUrl = baseInput.value;
        rows.forEach((r, i) => {
          if (!r.relative) return;
          const before = r.url;
          resolveRow(r);
          if (r.url === before) return;
          applySuggestion(r);
          const input = $(`[data-bd-name="${i}"]`, root);
          if (input) input.value = r.filename;
          const tr = $(`[data-bd-row="${i}"]`, root);
          if (tr) tr.querySelector(".bd-col-url").innerHTML = urlCellHtml(r);
        });
        changed();
      });

      $("[data-bd-show]", root).addEventListener("change", (e) => { show = e.target.value; render(); scheduleAutosave(); });
      $("[data-bd-name-from]", root).addEventListener("change", (e) => {
        nameFrom = e.target.value;
        rows.forEach((r) => { if (!r.edited) applySuggestion(r); });
        render();
        scheduleAutosave();
      });

      const preferSelect = $("[data-bd-prefer]", root);
      if (preferSelect) {
        preferSelect.addEventListener("change", () => {
          prefer = preferSelect.value;
          applyPreference();
          render();
          scheduleAutosave();
        });
      }

      $("[data-bd-search]", root).addEventListener("input", (e) => {
        search = e.target.value;
        lastClicked = null;
        refreshStatus();
      });

      const setShown = (value) => {
        rows.forEach((r, i) => { if (isShown(r)) setChecked(i, value); });
        changed();
      };
      root.querySelectorAll("[data-bd-check-shown]").forEach((btn) => {
        btn.addEventListener("click", () => setShown(btn.dataset.bdCheckShown === "1"));
      });

      $("[data-bd-chips]", root).addEventListener("click", (e) => {
        const chip = e.target.closest("[data-bd-chip]");
        if (!chip) return;
        const ext = chip.dataset.bdChip;
        const value = chip.getAttribute("aria-pressed") !== "true";
        rows.forEach((r, i) => { if (r.ext === ext && isShown(r)) setChecked(i, value); });
        changed();
      });

      $("[data-bd-view-script]", root).addEventListener("click", (e) => {
        scriptOpen = !scriptOpen;
        const panel = $("[data-bd-script]", root);
        panel.hidden = !scriptOpen;
        if (scriptOpen) fillScriptPanel();
        e.currentTarget.textContent = scriptOpen ? "Hide script" : "View script";
        e.currentTarget.setAttribute("aria-expanded", String(scriptOpen));
      });

      $("[data-bd-export]", root).addEventListener("click", exportBundle);

      const table = $(".bd-table", root);
      if (!table) return;

      table.addEventListener("input", (e) => {
        const nameInput = e.target.closest("[data-bd-name]");
        if (!nameInput) return;
        const r = rows[Number(nameInput.dataset.bdName)];
        r.filename = nameInput.value;
        r.edited = true;
        changed();
      });

      table.addEventListener("change", (e) => {
        const checkAll = e.target.closest("[data-bd-check-all]");
        if (checkAll) {
          setShown(checkAll.checked);
          return;
        }
        const ext = e.target.closest("[data-bd-ext]");
        if (ext) {
          const r = rows[Number(ext.dataset.bdExt)];
          r.ext = ext.value;
          r.extEdited = true;
          changed();
        }
      });

      // Row checkboxes are handled on click (not change) to read shiftKey.
      // Shift+click applies the clicked box's new state to every shown row
      // between it and the previously clicked box.
      table.addEventListener("click", (e) => {
        const check = e.target.closest("[data-bd-check]");
        if (check) {
          const i = Number(check.dataset.bdCheck);
          const order = $$("tbody tr[data-bd-row]:not([hidden])", root).map((tr) => Number(tr.dataset.bdRow));
          const from = order.indexOf(lastClicked);
          const to = order.indexOf(i);
          if (e.shiftKey && from >= 0 && to >= 0) {
            const [a, b] = from < to ? [from, to] : [to, from];
            order.slice(a, b + 1).forEach((idx) => setChecked(idx, check.checked));
            window.getSelection()?.removeAllRanges();
          } else {
            rows[i].checked = check.checked;
          }
          lastClicked = i;
          changed();
          return;
        }
        const fixBtn = e.target.closest("[data-bd-fix]");
        if (!fixBtn) return;
        const i = Number(fixBtn.dataset.bdFix);
        const r = rows[i];
        r.filename = F.fix(r.filename, r.ext);
        r.edited = true;
        const input = $(`[data-bd-name="${i}"]`, root);
        if (input) { input.value = r.filename; input.focus(); }
        changed();
      });
    }

    // ── Export and History ──────────────────────────────────────────────────

    async function exportBundle() {
      const btn = $("[data-bd-export]", root);
      const results = validateAll();
      const { selected, problems } = summary(results);
      if (!selected || problems) { refreshStatus(); return; }
      exportMessage = "";
      historyMessage = "";

      if (!window.JSZip) {
        exportMessage = "The zip builder didn't load. Check your connection and refresh the page.";
        refreshStatus();
        return;
      }

      const chosen = rows.filter((r) => r.checked).map((r) => ({ url: r.url, filename: r.filename.trim(), ext: r.ext }));
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Building…";
      try {
        const zip = new JSZip();
        for (const f of ns.batchDownloadBundle.bundleFiles(chosen)) zip.file(f.name, f.content);
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        downloadBlob(blob, `batch-download-${slugOf(sourceLabel) || "files"}.zip`);
      } catch (err) {
        exportMessage = `Couldn't create the download bundle (${err && err.message ? err.message : "unknown error"}). Try again; if it keeps failing, try fewer rows or another browser.`;
        btn.textContent = orig;
        refreshStatus();
        return;
      }

      exportCount += 1;
      lastExportedAt = Date.now();
      saveSession();
      btn.textContent = "✓ Bundle downloaded";
      btn.classList.add("btn-success");
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove("btn-success");
        refreshStatus();
      }, 2000);
    }

    function sessionData() {
      return {
        id: sessionId,
        timestamp: Date.now(),
        inputType: "batch-download",
        sourceLabel,
        baseUrl,
        show,
        nameFrom,
        prefer,
        rows: rows.map((r) => ({
          url: r.relative ? "" : r.url,
          rawHref: r.rawHref,
          visibleText: r.visibleText,
          filename: r.filename,
          ext: r.ext,
          checked: r.checked,
          edited: r.edited,
          extEdited: r.extEdited,
        })),
        exportCount,
        lastExportedAt,
        version: SESSION_VERSION,
      };
    }

    // First export creates the History entry; later exports and edits update it.
    function saveSession() {
      clearTimeout(autosaveTimer);
      if (!sessionId) sessionId = `batch-${Date.now()}`;
      const data = sessionData();
      const ok = ns.history.update(sessionId, data) || ns.history.add(data);
      const msg = ok ? "" : "Your bundle downloaded, but this session couldn't be saved to History (browser storage is full or blocked). Clear old History entries to make room.";
      if (msg !== historyMessage) {
        historyMessage = msg;
        refreshStatus();
      }
    }

    function scheduleAutosave() {
      if (!exportCount || !sessionId) return;
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(saveSession, AUTOSAVE_MS);
    }

    // ── API for the rail ────────────────────────────────────────────────────

    function resetState() {
      clearTimeout(autosaveTimer);
      rows = [];
      sourceLabel = "";
      baseUrl = "";
      show = "docs";
      nameFrom = "text";
      prefer = "pdf";
      formatGroupCount = 0;
      search = "";
      lastClicked = null;
      extractionError = "";
      restoreFailed = false;
      sessionId = null;
      exportCount = 0;
      lastExportedAt = null;
      historyMessage = "";
      exportMessage = "";
    }

    // `links` may include relative entries ({ url: "", rawHref }).
    function setLinks(links, label, { baseUrl: detectedBase = "", error = "" } = {}) {
      resetState();
      loaded = true;
      sourceLabel = label;
      baseUrl = detectedBase;
      extractionError = error;
      rows = links.map(makeRow);
      computeGroups();
      applyPreference();
      render();
    }

    function reset() {
      resetState();
      loaded = false;
      render();
    }

    // Returns the session's label, or null if it couldn't be restored.
    function restoreSession(s) {
      resetState();
      const valid = s && s.version === SESSION_VERSION && Array.isArray(s.rows) &&
        s.rows.every((r) => r && typeof r.rawHref === "string" && typeof r.filename === "string" && typeof r.ext === "string");
      if (!valid) {
        restoreFailed = true;
        loaded = false;
        render();
        return null;
      }
      loaded = true;
      sessionId = s.id;
      sourceLabel = String(s.sourceLabel || "");
      baseUrl = String(s.baseUrl || "");
      show = s.show === "all" ? "all" : "docs";
      nameFrom = s.nameFrom === "url" ? "url" : "text";
      // Sessions saved before this setting existed kept every format.
      prefer = ["pdf", "word", "all"].includes(s.prefer) ? s.prefer : "all";
      exportCount = Number(s.exportCount) || 0;
      lastExportedAt = s.lastExportedAt || null;
      rows = s.rows.map((saved, i) => {
        const url = ns.cleanUrl(saved.url || "");
        const row = makeRow({ url, rawHref: saved.rawHref, visibleText: String(saved.visibleText || "") }, i);
        row.filename = saved.filename;
        row.ext = /^[a-z0-9]{1,10}$/.test(saved.ext) ? saved.ext : "auto";
        row.checked = !!saved.checked;
        row.edited = !!saved.edited;
        row.extEdited = !!saved.extEdited;
        return row;
      });
      // Recompute groups for display only; saved names and checks win.
      const savedNames = rows.map((r) => r.filename);
      computeGroups();
      rows.forEach((r, i) => { r.filename = savedNames[i]; });
      render();
      return sourceLabel;
    }

    return { setLinks, reset, restoreSession };
  };
})();
