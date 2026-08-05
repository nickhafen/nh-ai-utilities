(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, $$, escapeHtml } = ns;

  const removals = [
    ["formatting",    "Inline formatting",               "Bold, italics, underline, and strikethrough"],
    ["headersFooters","Headers and footers",              "Repeated document-level content"],
    ["pageNumbers",   "Page numbers",                    "Standalone numbers and Page X of Y lines"],
    ["images",        "Image content",                   "Keep available alt text, omit embedded image data"],
    ["comments",      "Comments and annotations",        "Reviewer notes and comment markers"],
    ["emptySpace",    "Empty paragraphs and extra spacing","Redundant whitespace only"],
  ];

  const DOCX_PART_GROUPS = [
    { re: /^word\/document\.xml$/i,   group: "body",         label: "Body content",       color: "#2563eb" },
    { re: /^word\/footnotes\.xml$/i,  group: "footnotes",    label: "Footnotes/endnotes", color: "#0891b2" },
    { re: /^word\/endnotes\.xml$/i,   group: "footnotes",    label: "Footnotes/endnotes", color: "#0891b2" },
    { re: /^word\/header\d+\.xml$/i,  group: "headerfooter", label: "Headers/footers",    color: "#7c3aed" },
    { re: /^word\/footer\d+\.xml$/i,  group: "headerfooter", label: "Headers/footers",    color: "#7c3aed" },
    { re: /^word\/styles\.xml$/i,     group: "styles",       label: "Styles",             color: "#d97706" },
    { re: /^word\/numbering\.xml$/i,  group: "numbering",    label: "List formatting",    color: "#b45309" },
    { re: /^word\/settings\.xml$/i,   group: "settings",     label: "Document settings",  color: "#92400e" },
  ];
  const DOCX_GROUP_ORDER = ["body", "footnotes", "headerfooter", "styles", "numbering", "settings"];

  const bytes = (n) => {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    const p = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
    const v = n / (1024 ** p);
    return `${v.toFixed(p === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[p]}`;
  };
  const number = (n) => new Intl.NumberFormat().format(n);

  // -- DOCX helpers --

  async function docxXmlParts(buffer) {
    if (!window.JSZip) return { parts: [], total: 0 };
    const zip = await JSZip.loadAsync(buffer);
    const groupAccum = {};
    await Promise.all(
      Object.keys(zip.files).map(async (name) => {
        const cfg = DOCX_PART_GROUPS.find((c) => c.re.test(name));
        if (!cfg) return;
        const xml = await zip.files[name].async("string");
        if (!xml.trim()) return;
        const tokens = await ns.countTokens(xml);
        if (!tokens) return;
        if (!groupAccum[cfg.group]) groupAccum[cfg.group] = { label: cfg.label, color: cfg.color, tokens: 0 };
        groupAccum[cfg.group].tokens += tokens;
      })
    );
    const parts = DOCX_GROUP_ORDER.filter((g) => groupAccum[g]).map((g) => ({ group: g, ...groupAccum[g] }));
    return { parts, total: parts.reduce((s, p) => s + p.tokens, 0) };
  }

  function xmlText(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) return "";
    return Array.from(doc.getElementsByTagNameNS("*", "p")).map((p) =>
      Array.from(p.querySelectorAll("*")).map((node) =>
        node.localName === "t" ? node.textContent : node.localName === "tab" ? "\t" : node.localName === "br" ? "\n" : ""
      ).join("").trim()
    ).filter(Boolean).join("\n");
  }

  async function documentParts(buffer) {
    if (!window.JSZip) return { headers: "", footers: "" };
    const zip = await JSZip.loadAsync(buffer);
    async function read(kind) {
      const names = Object.keys(zip.files).filter((name) => new RegExp(`^word/${kind}\\d+\\.xml$`, "i").test(name)).sort();
      return (await Promise.all(names.map(async (name) => xmlText(await zip.files[name].async("string"))))).filter(Boolean).join("\n\n");
    }
    return { headers: await read("header"), footers: await read("footer") };
  }

  function addPart(doc, label, text, first) {
    if (!text) return;
    const section = doc.createElement("section");
    section.dataset.docxPart = label.toLowerCase();
    section.innerHTML = `<h2>${label}</h2>`;
    text.split(/\n{2,}/).forEach((block) => { const p = doc.createElement("p"); p.textContent = block; section.appendChild(p); });
    first ? doc.body.prepend(section) : doc.body.append(section);
  }

  function clean(html, options, parts) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!options.headersFooters) {
      addPart(doc, "Header", parts.headers, true);
      addPart(doc, "Footer", parts.footers, false);
    }
    if (options.formatting) {
      doc.querySelectorAll("strong,b,em,i,u,s,strike,del").forEach((el) => el.replaceWith(...el.childNodes));
      doc.querySelectorAll("span").forEach((el) => {
        el.removeAttribute("style"); el.removeAttribute("class");
        if (!el.attributes.length) el.replaceWith(...el.childNodes);
      });
    }
    if (options.pageNumbers) doc.querySelectorAll("p,div").forEach((el) => {
      if (/^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(el.textContent.trim())) el.remove();
    });
    if (options.images) doc.querySelectorAll("img").forEach((img) => {
      const alt = img.getAttribute("alt")?.trim();
      img.replaceWith(doc.createTextNode(alt ? `[Image: ${alt}]` : "[Image omitted]"));
    });
    if (options.comments) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
      const found = []; while (walker.nextNode()) found.push(walker.currentNode);
      found.forEach((node) => node.remove());
      doc.querySelectorAll("[data-comment-id],a[id^='comment-'],sup.comment-reference").forEach((el) => el.remove());
    }
    if (options.emptySpace) doc.querySelectorAll("p,div").forEach((el) => {
      if (!el.textContent.trim() && !el.querySelector("img,table")) el.remove();
    });
    return doc;
  }

  // Shared Turndown factory used by both the DOCX markdown path and the HTML extraction path.
  function makeTurndown() {
    const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
    td.addRule("tables", {
      filter: "table",
      replacement(content, table) {
        const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
          Array.from(row.children).filter((cell) => /^(TD|TH)$/.test(cell.tagName))
            .map((cell) => cell.textContent.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim())
        ).filter((row) => row.length);
        if (!rows.length) return "";
        const width = Math.max(...rows.map((row) => row.length));
        rows.forEach((row) => { while (row.length < width) row.push(""); });
        const line = (row) => `| ${row.join(" | ")} |`;
        return `\n\n${line(rows[0])}\n${line(Array(width).fill("---"))}\n${rows.slice(1).map(line).join("\n")}\n\n`;
      },
    });
    return td;
  }

  function markdown(doc) {
    const body = doc.body.cloneNode(true);
    const td = makeTurndown();
    td.addRule("footnoteReferences", {
      filter: (node) => node.nodeName === "SPAN" && node.hasAttribute("data-footnote-reference"),
      replacement: (content, node) => `[^${node.getAttribute("data-footnote-reference")}]`,
    });
    body.querySelectorAll('a[href^="#footnote-"]').forEach((link) => {
      const match = link.getAttribute("href").match(/^#footnote-(\d+)$/);
      if (!match || !link.id.startsWith("footnote-ref-")) return;
      const marker = document.createElement("span");
      marker.setAttribute("data-footnote-reference", match[1]);
      (link.closest("sup") || link).replaceWith(marker);
    });
    const footnotes = [];
    body.querySelectorAll('li[id^="footnote-"]').forEach((item) => {
      const match = item.id.match(/^footnote-(\d+)$/);
      if (!match) return;
      const clone = item.cloneNode(true);
      clone.querySelectorAll('a[href^="#footnote-ref-"]').forEach((link) => link.remove());
      footnotes.push({ number: Number(match[1]), html: clone.innerHTML });
      const list = item.parentElement; item.remove();
      if (list && !list.children.length) list.remove();
    });
    const main = td.turndown(body.innerHTML).replace(/\n{3,}/g, "\n\n").trim();
    const definitions = footnotes.sort((a, b) => a.number - b.number).map((fn) => {
      const content = td.turndown(fn.html).replace(/\n{3,}/g, "\n\n").trim();
      return `[^${fn.number}]: ${content.replace(/\n/g, "\n    ")}`;
    });
    return `${main}${definitions.length ? `\n\n${definitions.join("\n\n")}` : ""}\n`;
  }

  // -- HTML/website helpers --

  // Entry point for acquiring a DOM Document from a file.
  // Isolated here so a future URL-fetch path can slot in without touching the pipeline.
  async function getSourceDocument(file) {
    return new DOMParser().parseFromString(await file.text(), "text/html");
  }

  // Returns cleaned HTML with scripts/styles/comments stripped — the baseline
  // token cost of sharing raw page HTML with an LLM.
  function cleanBaseline(doc) {
    const clone = doc.cloneNode(true);
    clone.querySelectorAll("script,style,noscript").forEach((el) => el.remove());
    const walker = clone.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach((n) => n.remove());
    return clone.documentElement.outerHTML;
  }

  // -- Shared utilities --

  function save(text, name, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  async function copyWithFeedback(btn, getText) {
    const orig = btn.textContent;
    btn.disabled = true;
    try {
      await ns.copyText(getText());
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

  // ---- Tool registration ----

  ns.registerTool({
    id: "document-converter",
    name: "Token Saver",
    description: "Convert DOCX files and saved web pages to Markdown",
    render(root) {
      let file = null, fileType = null, output = null, busy = false;

      root.innerHTML = `
        <section class="tool-view converter-tool">
          <section class="panel converter-intro">
            <div class="panel-header converter-intro-header">
              <div>
                <span class="panel-title">Token Saver</span>
                <p class="cp-subtitle">Convert Word documents and saved web pages to Markdown before sharing with an AI tool.</p>
              </div>
              <div class="coming-soon" aria-label="More input types coming soon"><span class="coming-label">Coming next</span>
                <span>URL paste</span><span>PPT</span><span>PDF</span><span>Screenshots</span>
              </div>
            </div>
          </section>

          <details class="converter-notes">
            <summary>Important notes</summary>
            <div class="converter-notes-body">
              <p><strong>File size:</strong> There is no hard size limit, but files over roughly 50 MB may be slow to process or may not complete depending on your device's available memory. DOCX files with many embedded images can be slow even when the file size appears small.</p>
              <p><strong>DOCX token count:</strong> The &ldquo;before&rdquo; count reflects the raw XML content inside the .docx archive &mdash; what an AI tool actually processes when you upload a DOCX directly. Actual counts depend on the model, platform, and how that platform processes uploaded files.</p>
              <p><strong>DOCX footnotes:</strong> Markdown exports use compact footnote references and definitions without return-link overhead.</p>
              <p><strong>DOCX images:</strong> By default, embedded image data is removed and available alt text is retained. If images are kept, Word may represent them as large embedded data URLs. An AI tool may not fetch or view an image even when a URL is present.</p>
              <p><strong>Web page — URL pasting not yet supported:</strong> Browser security restrictions prevent fetching arbitrary URLs client-side. Save the page from your browser (&ldquo;Save Page As &rarr; Webpage, HTML Only&rdquo; or equivalent) and upload the resulting .html file.</p>
              <p><strong>Web page — content extraction:</strong> Main content is identified using Mozilla Readability (the engine behind Firefox Reader View). Extraction is usually accurate but may occasionally mis-classify content &mdash; e.g. stripping a legitimate block that looks like a sidebar, or retaining a promotional block that resembles main content.</p>
              <p><strong>Web page — token count:</strong> The &ldquo;before&rdquo; count reflects the page&rsquo;s visible HTML with scripts and styles stripped &mdash; roughly what an AI would process if given the raw page HTML. Dynamic content loaded after the initial page load is not included.</p>
            </div>
          </details>

          <div class="converter-layout">
            <div class="converter-controls">
              <section class="panel">
                <div class="panel-header"><h2 class="panel-title">Add a file</h2></div>
                <div class="panel-body">
                  <div id="cv-drop" class="drop-area converter-drop" role="button" tabindex="0" aria-label="Choose a file">
                    <span id="cv-drop-icon" class="drop-icon">DOCX / HTML</span>
                    <strong id="cv-file-label" class="primary-text">Drop a .docx or .html file here</strong>
                    <span class="hint">or click to choose &mdash; processed only in this browser</span>
                    <input id="cv-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.html,.htm,text/html" hidden>
                  </div>
                  <p id="cv-error" class="converter-error" role="alert" hidden></p>
                </div>
              </section>

              <section id="cv-docx-options" class="panel" hidden>
                <div class="panel-header"><h2 class="panel-title">Removal options</h2></div>
                <div class="panel-body">
                  <fieldset id="cv-removals" class="remove-options"><legend class="sr-only">Elements to remove before converting</legend>
                    ${removals.map(([id, label, help]) => `<label class="remove-option"><input type="checkbox" value="${id}" checked><span><strong>${label}</strong><small>${help}</small></span></label>`).join("")}
                  </fieldset>
                </div>
              </section>

              <button id="cv-run" class="btn btn-primary converter-run" type="button" disabled>Convert</button>
            </div>

            <section class="panel converter-result" aria-live="polite">
              <div class="panel-header">
                <div>
                  <h2 class="panel-title">Review the savings</h2>
                  <p id="cv-result-name" class="converter-result-name">Your converted file will appear here.</p>
                </div>
                <div class="panel-actions">
                  <button id="cv-copy" class="btn btn-secondary" type="button" disabled>Copy Markdown</button>
                  <button id="cv-download" class="btn btn-secondary" type="button" disabled>Download .md</button>
                </div>
              </div>
              <div class="panel-body converter-result-body">
                <div id="cv-empty" class="converter-empty">
                  <span class="converter-empty-mark">Aa</span>
                  <strong>Ready when you are</strong>
                  <p>Add a DOCX or HTML file to get started.</p>
                </div>
                <div id="cv-output" hidden>
                  <div class="savings-grid">
                    <div class="savings-card">
                      <span id="cv-before-label">Before</span>
                      <strong id="cv-before-size">--</strong>
                      <small id="cv-before-tokens">-- estimated tokens</small>
                    </div>
                    <div class="savings-arrow" aria-hidden="true">to</div>
                    <div class="savings-card savings-card-after">
                      <span>Markdown</span>
                      <strong id="cv-after-size">--</strong>
                      <small id="cv-after-tokens">-- tokens</small>
                    </div>
                  </div>
                  <p id="cv-token-caveat" class="token-caveat"></p>
                  <details id="cv-breakdown" class="token-breakdown" hidden>
                    <summary class="token-breakdown-toggle">Token composition breakdown</summary>
                    <div class="token-breakdown-body">
                      <div class="token-breakdown-row">
                        <div id="cv-bar1-label" class="token-breakdown-label">Input</div>
                        <div id="cv-bar1" class="seg-bar"></div>
                      </div>
                      <div id="cv-bar2-row" class="token-breakdown-row" hidden>
                        <div class="token-breakdown-label">Markdown output</div>
                        <div id="cv-bar2" class="seg-bar"></div>
                      </div>
                    </div>
                  </details>
                  <label class="preview-label" for="cv-preview">Output preview</label>
                  <textarea id="cv-preview" class="textarea output converter-preview" readonly></textarea>
                  <p id="cv-messages" class="hint"></p>
                </div>
              </div>
            </section>
          </div>
        </section>`;

      const input    = $("#cv-file", root);
      const drop     = $("#cv-drop", root);
      const run      = $("#cv-run", root);
      const copy     = $("#cv-copy", root);
      const download = $("#cv-download", root);
      const optionsEl = $("#cv-removals", root);
      const error    = $("#cv-error", root);
      const fail     = (message) => { error.textContent = message; error.hidden = !message; };

      function select(selected) {
        if (!selected) return;
        const lower = selected.name.toLowerCase();
        if (lower.endsWith(".docx")) {
          fileType = "docx";
        } else if (lower.endsWith(".html") || lower.endsWith(".htm")) {
          fileType = "html";
        } else {
          file = null; fileType = null; run.disabled = true;
          return fail("Please choose a .docx, .html, or .htm file.");
        }
        file = selected; output = null; fail("");
        run.disabled = false; copy.disabled = true; download.disabled = true;
        $("#cv-file-label", root).textContent = `${file.name} — ${bytes(file.size)}`;
        $("#cv-drop-icon", root).textContent = fileType === "html" ? "HTML" : "DOCX";
        $("#cv-docx-options", root).hidden = fileType !== "docx";
        run.textContent = fileType === "html" ? "Extract main content" : "Convert to Markdown";
      }

      function selectedOptions() {
        const checked = new Set($$("input:checked", optionsEl).map((el) => el.value));
        return Object.fromEntries(removals.map(([id]) => [id, checked.has(id)]));
      }

      // Populates the shared results panel fields used by both pipelines.
      function populateResults({ beforeLabel, beforeTokensText, caveat, content, outBytes, beforeTokens, afterTokens, tokenCountError }) {
        $("#cv-before-label", root).textContent = beforeLabel;
        $("#cv-empty", root).hidden = true;
        $("#cv-output", root).hidden = false;
        $("#cv-result-name", root).textContent = output.name;
        $("#cv-before-size", root).textContent = bytes(file.size);

        const sizePct = file.size && outBytes !== file.size
          ? ` (${Math.round(Math.abs((file.size - outBytes) / file.size) * 100)}% ${outBytes < file.size ? "smaller" : "larger"})`
          : "";
        $("#cv-after-size", root).textContent = `${bytes(outBytes)}${sizePct}`;

        $("#cv-before-tokens", root).textContent = beforeTokensText;
        if (tokenCountError) {
          $("#cv-after-tokens", root).textContent = "Token estimate unavailable";
        } else {
          const tokenPct = (beforeTokens && afterTokens !== beforeTokens)
            ? ` (${Math.round(Math.abs((beforeTokens - afterTokens) / beforeTokens) * 100)}% ${afterTokens < beforeTokens ? "fewer" : "more"})`
            : "";
          $("#cv-after-tokens", root).textContent = `${number(afterTokens)} tokens${tokenPct}`;
        }

        $("#cv-token-caveat", root).innerHTML = caveat;

        const limit = 24000;
        $("#cv-preview", root).value = content.length > limit
          ? `${content.slice(0, limit)}\n\n[Preview truncated. The download is complete.]`
          : content;

        copy.disabled = false;
        download.disabled = false;
        run.textContent = "Convert again";
      }

      async function convertDocx() {
        if (!window.mammoth || !window.TurndownService) {
          fail("A conversion library did not load. Check your connection and refresh the page.");
          run.textContent = "Try again"; return;
        }
        const buffer = await file.arrayBuffer();
        const [result, parts, xmlParts] = await Promise.all([
          mammoth.convertToHtml({ arrayBuffer: buffer.slice(0) }),
          documentParts(buffer.slice(0)),
          docxXmlParts(buffer.slice(0)),
        ]);
        const finalDoc = clean(result.value, selectedOptions(), parts);
        const content = markdown(finalDoc);
        const base = file.name.replace(/\.docx$/i, "");
        output = { content, mime: "text/markdown", name: `${base}.md` };
        const outBytes = new Blob([content]).size;

        let beforeTokens = null, afterTokens = null, plainTextTokens = null, tokenCountError = false;
        try {
          [afterTokens, plainTextTokens] = await Promise.all([
            ns.countTokens(content),
            ns.countTokens(ns.plainTextOfHtml(finalDoc.body.innerHTML)),
          ]);
          beforeTokens = xmlParts.total || null;
          if (!beforeTokens) tokenCountError = true;
        } catch { tokenCountError = true; }

        populateResults({
          beforeLabel: "DOCX (raw XML)",
          beforeTokensText: tokenCountError ? "Token estimate unavailable" : `${number(beforeTokens)} estimated XML tokens`,
          caveat: `Token counts are local estimates using the <code>o200k_base</code> encoding. The DOCX count reflects raw XML across all document parts. Your AI tool may tokenize or process the file differently.`,
          content, outBytes, beforeTokens, afterTokens, tokenCountError,
        });

        const breakdown = $("#cv-breakdown", root);
        if (!tokenCountError && xmlParts.parts.length > 0) {
          $("#cv-bar1-label", root).textContent = "DOCX input";
          ns.renderSegBar($("#cv-bar1", root), xmlParts.parts, beforeTokens);
          const fmtTokens = afterTokens - plainTextTokens;
          const segs = [{ label: "Plain text", tokens: plainTextTokens, color: "#2563eb" }];
          if (fmtTokens > 0) segs.push({ label: "Markdown formatting", tokens: fmtTokens, color: "#d97706" });
          ns.renderSegBar($("#cv-bar2", root), segs, afterTokens);
          $("#cv-bar2-row", root).hidden = false;
          breakdown.hidden = false;
        } else {
          breakdown.hidden = true;
        }

        const parserNote = result.messages.length
          ? `${result.messages.length} conversion note${result.messages.length === 1 ? "" : "s"}. Review complex layouts in the preview.`
          : "Conversion completed without parser warnings.";
        $("#cv-messages", root).textContent = tokenCountError
          ? `${parserNote} The local tokenizer could not load, so no token estimate is shown.`
          : parserNote;
      }

      async function convertHtml() {
        if (!window.Readability) {
          fail("The Readability library did not load. Check your connection and refresh the page.");
          run.textContent = "Try again"; return;
        }
        if (!window.TurndownService) {
          fail("The Turndown library did not load. Check your connection and refresh the page.");
          run.textContent = "Try again"; return;
        }
        const doc = await getSourceDocument(file);
        const baselineHtml = cleanBaseline(doc);
        const article = new Readability(doc.cloneNode(true)).parse();
        if (!article || !article.content) {
          fail("Readability could not extract meaningful content from this page. The file may have too little body text, or content may load dynamically.");
          run.textContent = "Try again"; return;
        }

        const content = makeTurndown().turndown(article.content).replace(/\n{3,}/g, "\n\n").trim() + "\n";
        const base = file.name.replace(/\.html?$/i, "");
        output = { content, mime: "text/markdown", name: `${base}.md` };
        const outBytes = new Blob([content]).size;

        let beforeTokens = null, afterTokens = null, mainContentTokens = null, plainTextTokens = null, tokenCountError = false;
        try {
          [beforeTokens, afterTokens, mainContentTokens, plainTextTokens] = await Promise.all([
            ns.countTokens(baselineHtml),
            ns.countTokens(content),
            ns.countTokens(article.content),
            ns.countTokens(ns.plainTextOfHtml(article.content)),
          ]);
        } catch { tokenCountError = true; }

        populateResults({
          beforeLabel: "Website (HTML)",
          beforeTokensText: tokenCountError ? "Token estimate unavailable" : `${number(beforeTokens)} estimated HTML tokens`,
          caveat: `Token counts are local estimates using the <code>o200k_base</code> encoding. The HTML count reflects visible markup with scripts and styles stripped. Your AI tool may tokenize differently.`,
          content, outBytes, beforeTokens, afterTokens, tokenCountError,
        });

        const breakdown = $("#cv-breakdown", root);
        if (!tokenCountError) {
          const chromeTokens = Math.max(0, beforeTokens - mainContentTokens);
          const htmlSegs = [{ label: "Main content", tokens: mainContentTokens, color: "#2563eb" }];
          if (chromeTokens > 0) htmlSegs.push({ label: "Ads/nav/chrome", tokens: chromeTokens, color: "#d97706" });
          $("#cv-bar1-label", root).textContent = "Website HTML input";
          ns.renderSegBar($("#cv-bar1", root), htmlSegs, beforeTokens);

          const fmtTokens = Math.max(0, afterTokens - plainTextTokens);
          const mdSegs = [{ label: "Plain text", tokens: plainTextTokens, color: "#2563eb" }];
          if (fmtTokens > 0) mdSegs.push({ label: "Markdown formatting", tokens: fmtTokens, color: "#d97706" });
          ns.renderSegBar($("#cv-bar2", root), mdSegs, afterTokens);
          $("#cv-bar2-row", root).hidden = false;
          breakdown.hidden = false;
        } else {
          breakdown.hidden = true;
        }

        const titleNote = article.title ? `"${article.title}" — ` : "";
        $("#cv-messages", root).textContent = `${titleNote}Extraction completed. Review the preview to confirm Readability captured the right content.`;
      }

      async function convert() {
        if (!file || busy) return;
        busy = true; fail(""); run.disabled = true;
        run.textContent = fileType === "html" ? "Extracting…" : "Converting…";
        try {
          if (fileType === "html") { await convertHtml(); } else { await convertDocx(); }
        } catch (err) {
          console.error(err);
          fail(fileType === "html"
            ? "This file could not be processed. Make sure it is a valid HTML file."
            : "This document could not be converted. Make sure it is a valid, unencrypted .docx file.");
          run.textContent = "Try again";
        } finally { busy = false; run.disabled = !file; }
      }

      drop.addEventListener("click", () => input.click());
      drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
      input.addEventListener("change", () => select(input.files[0]));
      ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("drag-over"); }));
      ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("drag-over"); }));
      drop.addEventListener("drop", (e) => select(e.dataTransfer.files[0]));
      run.addEventListener("click", convert);
      copy.addEventListener("click", () => output && copyWithFeedback(copy, () => output.content));
      download.addEventListener("click", () => output && save(output.content, output.name, output.mime));
    },
  });
})();
