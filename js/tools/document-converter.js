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

  // PPTX removal list: [id, label, help, defaultRemoved]. Checked items are
  // removed, matching the DOCX panel's semantics. Toggling recalculates both
  // the raw-XML baseline and the Markdown output.
  const pptxToggles = [
    ["speakerNotes",       "Speaker notes",                  "Presenter notes attached to slides", true],
    ["hiddenSlides",       "Hidden slides",                  "Slides marked hidden in the deck", true],
    ["slideFooters",       "Slide numbers and footers",      "Recurring footer, date, and slide-number text", true],
    ["masterPlaceholders", "Master/layout placeholder text", "Template text from slide masters and layouts", true],
    ["embeddedData",       "Embedded object data",           "Chart titles, series, and cached backing data", false],
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
        return `\n\n${ns.markdownTable(rows)}\n\n`;
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

  // ---- Token-estimate explainer text, per input type ----
  // Shown in each type's "Token estimate settings" panel, not in the results
  // box — these are static (no per-conversion numbers). PDF's is dynamic
  // (embeds computed token counts) and is built in recomputePdf() instead.
  const CAVEATS = {
    docx:  `Token counts are local estimates using the <code>o200k_base</code> encoding. The DOCX count reflects raw XML across all document parts. Your AI tool may tokenize or process the file differently.`,
    pptx:  `Token counts are local estimates using the <code>o200k_base</code> encoding. The PPTX count reflects the raw XML of the parts currently included by the toggles. Your AI tool may tokenize or process the file differently.`,
    html:  `Token counts are local estimates using the <code>o200k_base</code> encoding. The HTML count reflects visible markup with scripts and styles stripped. Your AI tool may tokenize differently.`,
    image: `The &ldquo;before&rdquo; figure uses the selected vision model&rsquo;s <em>published image-token formula</em> based on pixel dimensions &mdash; not the <code>o200k_base</code> text tokenizer used for the Markdown side. The two numbers are different accounting methods; the comparison shows sending the raw screenshot vs. sending the extracted text.`,
  };

  // ---- Important-notes content, per input type ----

  const NOTE_SECTIONS = {
    general: [
      `<p><strong>File size:</strong> There is no hard size limit, but files over roughly 50 MB may be slow to process or may not complete depending on your device's available memory. Files with many embedded images can be slow even when the file size appears small.</p>`,
    ],
    docx: [
      `<p><strong>DOCX token count:</strong> The &ldquo;before&rdquo; count reflects the raw XML content inside the .docx archive &mdash; what an AI tool actually processes when you upload a DOCX directly. Actual counts depend on the model, platform, and how that platform processes uploaded files.</p>`,
      `<p><strong>DOCX footnotes:</strong> Markdown exports use compact footnote references and definitions without return-link overhead.</p>`,
      `<p><strong>DOCX images:</strong> By default, embedded image data is removed and available alt text is retained. If images are kept, Word may represent them as large embedded data URLs. An AI tool may not fetch or view an image even when a URL is present.</p>`,
    ],
    html: [
      `<p><strong>URL pasting not yet supported:</strong> Browser security restrictions prevent fetching arbitrary URLs client-side. Save the page from your browser (&ldquo;Save Page As &rarr; Webpage, HTML Only&rdquo; or equivalent) and upload the resulting .html file.</p>`,
      `<p><strong>Content extraction:</strong> Main content is identified using Mozilla Readability (the engine behind Firefox Reader View). Extraction is usually accurate but may occasionally mis-classify content &mdash; e.g. stripping a legitimate block that looks like a sidebar, or retaining a promotional block that resembles main content.</p>`,
      `<p><strong>Token count:</strong> The &ldquo;before&rdquo; count reflects the page&rsquo;s visible HTML with scripts and styles stripped &mdash; roughly what an AI would process if given the raw page HTML. Dynamic content loaded after the initial page load is not included.</p>`,
    ],
    image: [
      `<p><strong>A different &ldquo;before&rdquo; accounting method:</strong> The token cost of the original screenshot is estimated using the selected model&rsquo;s published image-tokenization formula (based on pixel dimensions), not <code>o200k_base</code>. This differs from every other conversion in this app, but it is the honest &ldquo;before&rdquo; comparison for how vision models actually charge for images.</p>`,
      `<p><strong>OCR accuracy:</strong> Results depend heavily on image resolution, font clarity, and contrast. Low-quality or low-resolution screenshots may produce inaccurate or incomplete text.</p>`,
      `<p><strong>Layout is lost:</strong> Spatial meaning (side-by-side comparisons, diagrams, charts) is not preserved &mdash; OCR captures readable text only, not visual structure.</p>`,
      `<p><strong>Non-text content:</strong> Icons, images within the screenshot, and chart graphics are not represented in the Markdown output.</p>`,
    ],
    pptx: [
      `<p><strong>Diagrams and SmartArt:</strong> May extract as fragmented or out-of-order text, or may not extract meaningfully at all.</p>`,
      `<p><strong>Charts:</strong> Titles, series names, and any cached data table stored in the chart XML are extracted when available; the original backing spreadsheet is usually not recoverable.</p>`,
      `<p><strong>Images inside slides are not OCR&rsquo;d:</strong> Any text that exists only inside an embedded image or screenshot on a slide is not captured in this version. This is a real gap for image-heavy decks.</p>`,
      `<p><strong>Spatial meaning is lost:</strong> A two-column comparison slide or a flowchart becomes a linear text flow that may not preserve the visual relationships that gave the slide its meaning.</p>`,
      `<p><strong>Text-first tool:</strong> For visually dense or diagram-heavy decks, professional document-processing tools often render slides as images and use a vision model directly. This tool optimizes for token reduction via text extraction &mdash; it trades some visual fidelity for a much lower token cost, and is not a full-fidelity converter.</p>`,
    ],
    pdf: [
      `<p><strong>Text-layer PDFs only:</strong> Scanned or image-only PDFs will produce little or no extracted text &mdash; OCR for PDFs is not supported in this version.</p>`,
      `<p><strong>Tables are best-effort:</strong> Complex tables, merged cells, or irregular layouts may convert incorrectly or lose structure. Low-confidence rows are left as plain text rather than forced into malformed table syntax.</p>`,
      `<p><strong>Multi-column layouts:</strong> Academic papers, newsletters, and similar layouts may have reading-order errors, since column detection is heuristic.</p>`,
      `<p><strong>Headings are inferred:</strong> Heading detection relies on font size and style and may be mis-detected in unusually formatted documents.</p>`,
      `<p><strong>Non-text content:</strong> Embedded images, charts, and other visual content are not extracted or represented in the Markdown output.</p>`,
      `<p><strong>Headers, footers, and page numbers</strong> are automatically stripped from the Markdown output but retained in the raw token baseline &mdash; this can make the token reduction look larger than the content-only savings alone.</p>`,
      `<p><strong>The &ldquo;before&rdquo; baseline combines two estimates:</strong> this tool's own naive text extraction, plus an estimated image-token cost for each page (many AI platforms rasterize PDF pages to images as well as extracting text). The image-token half uses your selected model's published formula &mdash; configurable in Removal options &mdash; applied to each page's dimensions at an assumed 150 DPI render, since no platform publishes the resolution it actually rasterizes PDF pages at. It's a closer approximation of a real PDF upload than text alone, but still an estimate. On documents with little repeated header/footer text to strip, Markdown's own syntax (headings, lists, table formatting) can outweigh the text-side savings and the token count can go up instead of down.</p>`,
    ],
  };

  // ---- Convert-to-Markdown workflow ----
  //
  // Mounted by the Document Tools rail (js/tools/document-tools.js) into a
  // container it owns. This module no longer owns file intake — the rail
  // detects the file type and calls setFile()/reset() on the API this
  // returns. Everything downstream (options, pipelines, results, History) is
  // unchanged from when this ran as its own "Token Saver" tool.
  ns.mountConvertWorkflow = function mountConvertWorkflow(root) {
      let file = null, fileType = null, output = null, busy = false;

      root.innerHTML = `
        <div class="converter-tool">
          <details class="converter-notes">
            <summary id="cv-notes-summary">Important notes</summary>
            <div id="cv-notes-body" class="converter-notes-body"></div>
          </details>

          <div class="converter-layout">
            <div class="converter-controls">
              <p id="cv-error" class="converter-error" role="alert" hidden></p>

              <section id="cv-docx-options" class="panel" hidden>
                <div class="panel-header"><h2 class="panel-title">Removal options</h2></div>
                <div class="panel-body">
                  <fieldset id="cv-removals" class="remove-options"><legend class="sr-only">Elements to remove before converting</legend>
                    ${removals.map(([id, label, help]) => `<label class="remove-option"><input type="checkbox" value="${id}" checked><span><strong>${label}</strong><small>${help}</small></span></label>`).join("")}
                  </fieldset>
                  <details class="token-breakdown">
                    <summary class="token-breakdown-toggle">Token estimate settings</summary>
                    <div class="token-breakdown-body">
                      <p class="hint">${CAVEATS.docx}</p>
                    </div>
                  </details>
                </div>
              </section>

              <section id="cv-pptx-options" class="panel" hidden>
                <div class="panel-header"><h2 class="panel-title">Removal options</h2></div>
                <div class="panel-body">
                  <fieldset id="cv-pptx-toggles" class="remove-options"><legend class="sr-only">Elements to remove before converting</legend>
                    ${pptxToggles.map(([id, label, help, on]) => `<label class="remove-option"><input type="checkbox" value="${id}"${on ? " checked" : ""}><span><strong>${label}</strong><small>${help}</small></span></label>`).join("")}
                  </fieldset>
                  <p class="hint" style="margin-top:.65rem">Checked content is removed from both sides: toggles recalculate the raw PPTX baseline and the Markdown output.</p>
                  <details class="token-breakdown">
                    <summary class="token-breakdown-toggle">Token estimate settings</summary>
                    <div class="token-breakdown-body">
                      <p class="hint">${CAVEATS.pptx}</p>
                    </div>
                  </details>
                </div>
              </section>

              <section id="cv-html-options" class="panel" hidden>
                <div class="panel-header"><h2 class="panel-title">Token estimate settings</h2></div>
                <div class="panel-body">
                  <p class="hint">${CAVEATS.html}</p>
                </div>
              </section>

              <section id="cv-pdf-options" class="panel" hidden>
                <div class="panel-header"><h2 class="panel-title">Removal options</h2></div>
                <div class="panel-body">
                  <p class="hint">Headers, footers, and page numbers are always stripped from the Markdown output — see Important notes for details.</p>
                  <details id="cv-pdf-settings" class="token-breakdown">
                    <summary class="token-breakdown-toggle">Token estimate settings</summary>
                    <div class="token-breakdown-body">
                      <label class="field">
                        <span>Model for the raw-PDF-upload estimate</span>
                        <select id="cv-pdf-model" class="text-input converter-select">
                          ${ns.IMAGE_TOKEN_MODELS.map((m) => `<option value="${m.id}"${m.id === "gpt4v" ? " selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}
                        </select>
                      </label>
                      <p id="cv-pdf-caveat" class="hint" style="margin-top:.65rem">Estimates each page's image-token cost using the selected model's published formula, assuming a 150 DPI render — providers don&rsquo;t publish the resolution they actually rasterize PDF pages at, so this is an approximation on top of an approximation.</p>
                    </div>
                  </details>
                </div>
              </section>

              <section id="cv-image-options" class="panel" hidden>
                <div class="panel-header"><h2 class="panel-title">Token estimate settings</h2></div>
                <div class="panel-body">
                  <label class="field">
                    <span>Model for the image-token estimate</span>
                    <select id="cv-image-model" class="text-input converter-select">
                      ${ns.IMAGE_TOKEN_MODELS.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("")}
                    </select>
                  </label>
                  <p class="hint" style="margin-top:.65rem">${CAVEATS.image}</p>
                </div>
              </section>

              <button id="cv-run" class="btn btn-primary converter-run" type="button" disabled>Convert</button>
            </div>

            <section class="panel converter-result" aria-live="polite">
              <div class="panel-header">
                <div>
                  <h2 class="panel-title">Markdown Output</h2>
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
                  <p>Add a file in the Document panel on the left to get started.</p>
                </div>
                <div id="cv-output" hidden>
                  <div class="stat-compare">
                    <div class="stat-compare-row stat-compare-head">
                      <span id="cv-before-label" class="stat-compare-side">Before</span>
                      <span class="stat-compare-vs" aria-hidden="true">&#10140;</span>
                      <span class="stat-compare-side stat-compare-side-after">MD</span>
                    </div>
                    <div class="stat-compare-row">
                      <span id="cv-before-tokens" class="stat-compare-value">--</span>
                      <span class="stat-compare-category">Tokens</span>
                      <span id="cv-after-tokens" class="stat-compare-value">-- tokens</span>
                    </div>
                    <div class="stat-compare-row">
                      <span id="cv-before-size" class="stat-compare-value">--</span>
                      <span class="stat-compare-category">File size</span>
                      <span id="cv-after-size" class="stat-compare-value">--</span>
                    </div>
                  </div>
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
                  <label class="preview-label" for="cv-preview">Preview</label>
                  <textarea id="cv-preview" class="textarea output converter-preview" readonly></textarea>
                  <p id="cv-messages" class="hint"></p>
                </div>
              </div>
            </section>
          </div>
        </div>`;

      const run      = $("#cv-run", root);
      const copy     = $("#cv-copy", root);
      const download = $("#cv-download", root);
      const optionsEl = $("#cv-removals", root);
      const pptxTogglesEl = $("#cv-pptx-toggles", root);
      const imageModelEl  = $("#cv-image-model", root);
      const pdfModelEl    = $("#cv-pdf-model", root);
      const error    = $("#cv-error", root);
      const fail     = (message) => { error.textContent = message; error.hidden = !message; };

      // Cached conversion state for live recalculation (PPTX toggles recompute
      // both sides from cached per-part token counts; the image model dropdown
      // recomputes only the baseline).
      let pptxState = null, imageState = null, pdfState = null, historyId = null;

      const TYPE_META = {
        docx:  { icon: "DOCX",  run: "Convert to Markdown" },
        pptx:  { icon: "PPTX",  run: "Convert to Markdown" },
        pdf:   { icon: "PDF",   run: "Convert to Markdown" },
        html:  { icon: "HTML",  run: "Extract main content" },
        image: { icon: "IMAGE", run: "Extract text (OCR)" },
      };

      function renderNotes(type) {
        const sections = type ? [type] : ["docx", "html", "pptx", "pdf", "image"];
        $("#cv-notes-summary", root).textContent = type ? `Important notes — ${TYPE_META[type].icon}` : "Important notes";
        $("#cv-notes-body", root).innerHTML =
          [...NOTE_SECTIONS.general, ...sections.flatMap((key) => NOTE_SECTIONS[key])].join("");
      }
      renderNotes(null);

      // Called by the Document Tools rail whenever a new compatible file is
      // added or an existing one is replaced. `type` is one of TYPE_META's
      // keys, already detected by the rail via ns.detectDocumentFileType.
      function setFile(newFile, type) {
        file = newFile; fileType = type; output = null; pptxState = null; imageState = null; pdfState = null; historyId = null; fail("");
        run.disabled = false; copy.disabled = true; download.disabled = true;
        $("#cv-docx-options", root).hidden = fileType !== "docx";
        $("#cv-pptx-options", root).hidden = fileType !== "pptx";
        $("#cv-html-options", root).hidden = fileType !== "html";
        $("#cv-pdf-options", root).hidden = fileType !== "pdf";
        $("#cv-image-options", root).hidden = fileType !== "image";
        run.textContent = TYPE_META[fileType].run;
        $("#cv-empty", root).hidden = false;
        $("#cv-output", root).hidden = true;
        renderNotes(fileType);
      }

      // Called when the rail's file is removed, clearing this workflow back
      // to its initial empty state.
      function reset() {
        file = null; fileType = null; output = null; pptxState = null; imageState = null; pdfState = null; historyId = null; fail("");
        run.disabled = true; copy.disabled = true; download.disabled = true;
        run.textContent = "Convert";
        $("#cv-docx-options", root).hidden = true;
        $("#cv-pptx-options", root).hidden = true;
        $("#cv-html-options", root).hidden = true;
        $("#cv-pdf-options", root).hidden = true;
        $("#cv-image-options", root).hidden = true;
        $("#cv-empty", root).hidden = false;
        $("#cv-output", root).hidden = true;
        renderNotes(null);
      }

      function selectedOptions() {
        const checked = new Set($$("input:checked", optionsEl).map((el) => el.value));
        return Object.fromEntries(removals.map(([id]) => [id, checked.has(id)]));
      }

      // The PPTX checkboxes use removal semantics (checked = removed) to match
      // the DOCX panel; the pipeline works with include flags, so invert here.
      function selectedPptxOptions() {
        const checked = new Set($$("input:checked", pptxTogglesEl).map((el) => el.value));
        return Object.fromEntries(pptxToggles.map(([id]) => [id, !checked.has(id)]));
      }

      // Rounded percentage that never overstates the extremes: 99.6% shows as
      // ">99" rather than 100, and 0.4% shows as "<1" rather than 0.
      const pctValue = (before, after) => {
        const raw = Math.abs((before - after) / before) * 100;
        const rounded = Math.round(raw);
        if (rounded === 100 && raw < 100) return ">99";
        if (rounded === 0 && raw > 0) return "<1";
        return String(rounded);
      };
      // Builds the colored "(x% fewer/more)" fragment used next to an after
      // value: green when the after side is smaller, red when it grew.
      const pctSpan = (before, after, downWord, upWord) => {
        if (!before || after === before) return "";
        const cls = after < before ? "is-good" : "is-bad";
        const word = after < before ? downWord : upWord;
        return ` <span class="stat-compare-pct ${cls}">(${pctValue(before, after)}% ${word})</span>`;
      };
      // Populates the shared results panel fields used by both pipelines.
      function populateResults({ beforeLabel, beforeTokensText, caveat, content, outBytes, beforeTokens, afterTokens, tokenCountError }) {
        $("#cv-before-label", root).textContent = beforeLabel;
        $("#cv-empty", root).hidden = true;
        $("#cv-output", root).hidden = false;
        $("#cv-result-name", root).textContent = output.name;
        $("#cv-before-size", root).textContent = bytes(file.size);

        const sizePct = file.size && outBytes !== file.size
          ? ` (${pctValue(file.size, outBytes)}% ${outBytes < file.size ? "smaller" : "larger"})`
          : "";
        $("#cv-after-size", root).innerHTML = `${bytes(outBytes)}${pctSpan(file.size, outBytes, "smaller", "larger")}`;

        $("#cv-before-tokens", root).textContent = beforeTokensText;
        if (tokenCountError) {
          $("#cv-after-tokens", root).textContent = "Token estimate unavailable";
        } else {
          $("#cv-after-tokens", root).innerHTML = `${number(afterTokens)} tokens${pctSpan(beforeTokens, afterTokens, "fewer", "more")}`;
        }

        const limit = 24000;
        $("#cv-preview", root).value = content.length > limit
          ? `${content.slice(0, limit)}\n\n[Preview truncated. The download is complete.]`
          : content;

        copy.disabled = false;
        download.disabled = false;
        run.textContent = "Convert again";

        // History: one entry per converted file, updated in place when the same
        // conversion is recalculated (PPTX toggles, "Convert again").
        const entry = {
          timestamp: Date.now(),
          sourceLabel: file.name,
          inputType: "conversion",
          fileType,
          outputName: output.name,
          beforeLabel,
          beforeSizeText: bytes(file.size),
          afterSizeText: `${bytes(outBytes)}${sizePct}`,
          beforeTokensText,
          afterTokensText: $("#cv-after-tokens", root).textContent,
          beforeTokens: tokenCountError ? null : beforeTokens,
          afterTokens: tokenCountError ? null : afterTokens,
          caveat,
          content: content.length > 200_000 ? content.slice(0, 200_000) : content,
          contentTruncated: content.length > 200_000,
        };
        if (historyId) {
          ns.history.update(historyId, entry);
        } else {
          historyId = `conversion-${Date.now()}`;
          ns.history.add({ id: historyId, ...entry });
        }
      }

      // Rebuilds the results panel from a saved History session. The original
      // file is not stored, so option panels stay hidden and Convert stays
      // disabled until a new file is added via the rail.
      function restoreSession(s) {
        file = null; fileType = null; pptxState = null; imageState = null; pdfState = null; historyId = null;
        output = { content: s.content, mime: "text/markdown", name: s.outputName };
        fail("");
        run.disabled = true;
        run.textContent = TYPE_META[s.fileType] ? TYPE_META[s.fileType].run : "Convert";
        $("#cv-docx-options", root).hidden = true;
        $("#cv-pptx-options", root).hidden = true;
        $("#cv-html-options", root).hidden = true;
        $("#cv-pdf-options", root).hidden = true;
        $("#cv-image-options", root).hidden = true;
        renderNotes(NOTE_SECTIONS[s.fileType] ? s.fileType : null);

        $("#cv-empty", root).hidden = true;
        $("#cv-output", root).hidden = false;
        $("#cv-result-name", root).textContent = s.outputName;
        $("#cv-before-label", root).textContent = s.beforeLabel;
        $("#cv-before-size", root).textContent = s.beforeSizeText;
        $("#cv-before-tokens", root).textContent = s.beforeTokensText;
        $("#cv-after-size", root).textContent = s.afterSizeText;
        $("#cv-after-tokens", root).textContent = s.afterTokensText;
        $("#cv-breakdown", root).hidden = true;

        const limit = 24000;
        $("#cv-preview", root).value = s.content.length > limit
          ? `${s.content.slice(0, limit)}\n\n[Preview truncated. The download is complete.]`
          : s.content;
        $("#cv-messages", root).textContent = s.contentTruncated
          ? "Restored from History. The stored Markdown was truncated to fit local storage — reconvert the original file for the full output."
          : "Restored from History. Add the original file in the Document panel on the left to reconvert with different options.";
        copy.disabled = false;
        download.disabled = false;
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
          beforeLabel: "DOCX",
          beforeTokensText: tokenCountError ? "Token estimate unavailable" : `${number(beforeTokens)} tokens`,
          caveat: CAVEATS.docx,
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
          beforeLabel: "HTML",
          beforeTokensText: tokenCountError ? "Token estimate unavailable" : `${number(beforeTokens)} tokens`,
          caveat: CAVEATS.html,
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

      // -- Screenshot (OCR) pipeline --

      // OCR text → lightly structured Markdown. Line breaks are preserved as
      // detected; bullets/numbers become Markdown lists; headings are inferred
      // only from Tesseract's line-height hints (a font-size proxy), never
      // guessed from text alone.
      function ocrMarkdown(ocr) {
        const src = ocr.lines.length ? ocr.lines : ocr.text.split("\n").map((t) => ({ text: t, height: 0 }));
        const heights = src.filter((l) => l.text.trim().length >= 4 && l.height > 0)
          .map((l) => l.height).sort((a, b) => a - b);
        const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
        const out = [];
        for (const line of src) {
          const text = line.text.replace(/\s+/g, " ").trim();
          if (!text) { if (out.length && out[out.length - 1] !== "") out.push(""); continue; }
          const bullet = text.match(/^[-–—•●○◦▪‣∙·*]\s+(.*)$/);
          const numbered = text.match(/^\(?(\d{1,3})[.)]\s+(.*)$/);
          if (bullet) out.push(`- ${bullet[1]}`);
          else if (numbered) out.push(`${numbered[1]}. ${numbered[2]}`);
          else if (median && line.height >= median * 1.45 && text.length <= 60 && !/[.,;:]$/.test(text)) {
            out.push("", line.height >= median * 1.9 ? `# ${text}` : `## ${text}`, "");
          } else out.push(text);
        }
        return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
      }

      // Rewrites the baseline card (and the after-card percentage) from the
      // selected vision model. Called on conversion and on dropdown change.
      function updateImageBaseline() {
        if (!imageState) return;
        const model = ns.IMAGE_TOKEN_MODELS.find((m) => m.id === imageModelEl.value) || ns.IMAGE_TOKEN_MODELS[0];
        const beforeTokens = ns.estimateImageTokens(imageState.width, imageState.height, model.id);
        $("#cv-before-tokens", root).textContent = `${number(beforeTokens)} tokens`;
        $("#cv-after-tokens", root).innerHTML = `${number(imageState.afterTokens)} tokens${pctSpan(beforeTokens, imageState.afterTokens, "fewer", "more")}`;
      }

      async function convertImage() {
        let width, height;
        try {
          const bitmap = await createImageBitmap(file);
          width = bitmap.width; height = bitmap.height;
          bitmap.close();
        } catch {
          fail("This image could not be read. Make sure it is a valid .png, .jpg, or .webp file.");
          run.textContent = "Try again"; return;
        }
        run.textContent = "Recognizing text…";
        const ocr = await ns.ocrImage(file, (p) => { run.textContent = `Recognizing text… ${Math.round(p * 100)}%`; });
        const content = ocrMarkdown(ocr);
        if (!content.trim()) {
          fail("No readable text was found in this image. OCR works best on clear, high-contrast screenshots of text.");
          run.textContent = "Try again"; return;
        }
        output = { content, mime: "text/markdown", name: `${file.name.replace(/\.(png|jpe?g|webp)$/i, "")}.md` };

        let afterTokens = null, tokenCountError = false;
        try { afterTokens = await ns.countTokens(content); } catch { tokenCountError = true; }
        imageState = tokenCountError ? null : { width, height, afterTokens };
        const beforeTokens = ns.estimateImageTokens(width, height, imageModelEl.value);

        populateResults({
          beforeLabel: "IMG",
          beforeTokensText: `${number(beforeTokens)} tokens`,
          caveat: CAVEATS.image,
          content, outBytes: new Blob([content]).size, beforeTokens, afterTokens, tokenCountError,
        });
        updateImageBaseline();
        $("#cv-breakdown", root).hidden = true;
        $("#cv-messages", root).textContent = tokenCountError
          ? "OCR completed, but the local tokenizer could not load, so no Markdown token estimate is shown."
          : "OCR completed. Review the preview — accuracy depends on the screenshot's resolution and contrast.";
      }

      // -- PPTX pipeline --

      async function convertPptx() {
        if (!window.JSZip) {
          fail("The zip library did not load. Check your connection and refresh the page.");
          run.textContent = "Try again"; return;
        }
        const parsed = await ns.parsePptx(await file.arrayBuffer());
        if (!parsed.slides.length) {
          fail("No slides were found in this file. Make sure it is a valid, unencrypted .pptx file.");
          run.textContent = "Try again"; return;
        }
        // Token-count every part once; toggle changes then recombine these
        // cached counts arithmetically instead of re-reading the file.
        const count = (s) => (s ? ns.countTokens(s) : Promise.resolve(0));
        const sum = (arr) => arr.reduce((a, b) => a + b, 0);
        const [slidesFull, slidesSansFooters, notes, charts, layouts, masters, theme, presentation] = await Promise.all([
          Promise.all(parsed.slides.map((s) => count(s.xml))),
          Promise.all(parsed.slides.map((s) => (s.xmlSansFooters ? count(s.xmlSansFooters) : Promise.resolve(null)))),
          Promise.all(parsed.slides.map((s) => count(s.notesXml))),
          Promise.all(parsed.slides.map((s) =>
            Promise.all(s.blocks.filter((b) => b.type === "chart" && b.chartXml).map((b) => count(b.chartXml))).then(sum))),
          Promise.all(parsed.layouts.map(count)).then(sum),
          Promise.all(parsed.masters.map(count)).then(sum),
          Promise.all(parsed.themes.map(count)).then(sum),
          count(parsed.presentationXml),
        ]);
        pptxState = { parsed, t: { slidesFull, slidesSansFooters, notes, charts, layouts, masters, theme, presentation } };
        await recomputePptx();
        const hiddenCount = parsed.slides.filter((s) => s.hidden).length;
        $("#cv-messages", root).textContent =
          `${parsed.slides.length} slide${parsed.slides.length === 1 ? "" : "s"} read` +
          `${hiddenCount ? ` (${hiddenCount} hidden)` : ""}. Toggles update both token counts immediately.`;
      }

      async function recomputePptx() {
        const { parsed, t } = pptxState;
        const options = selectedPptxOptions();

        let slideTokens = 0, notesTokens = 0, chartTokens = 0;
        parsed.slides.forEach((slide, i) => {
          if (slide.hidden && !options.hiddenSlides) return;
          slideTokens += options.slideFooters ? t.slidesFull[i] : (t.slidesSansFooters[i] ?? t.slidesFull[i]);
          if (options.speakerNotes) notesTokens += t.notes[i];
          if (options.embeddedData) chartTokens += t.charts[i];
        });
        const layoutTokens = options.masterPlaceholders ? t.layouts : 0;
        const masterTokens = options.masterPlaceholders ? t.masters : 0;
        const beforeTokens = slideTokens + notesTokens + chartTokens + layoutTokens + masterTokens + t.theme + t.presentation;

        const content = ns.pptxMarkdown(parsed, options);
        output = { content, mime: "text/markdown", name: `${file.name.replace(/\.pptx$/i, "")}.md` };

        let afterTokens = null, plainTokens = null, tokenCountError = false;
        try {
          [afterTokens, plainTokens] = await Promise.all([
            ns.countTokens(content),
            ns.countTokens(ns.plainTextOfMarkdown(content)),
          ]);
        } catch { tokenCountError = true; }

        populateResults({
          beforeLabel: "PPTX",
          beforeTokensText: tokenCountError ? "Token estimate unavailable" : `${number(beforeTokens)} tokens`,
          caveat: CAVEATS.pptx,
          content, outBytes: new Blob([content]).size, beforeTokens, afterTokens, tokenCountError,
        });

        const breakdown = $("#cv-breakdown", root);
        if (!tokenCountError && beforeTokens > 0) {
          const segs = [
            { label: "Slide content",         tokens: slideTokens,    color: "#2563eb" },
            { label: "Speaker notes",         tokens: notesTokens,    color: "#0891b2" },
            { label: "Layouts",               tokens: layoutTokens,   color: "#7c3aed" },
            { label: "Masters",               tokens: masterTokens,   color: "#9333ea" },
            { label: "Theme",                 tokens: t.theme,        color: "#d97706" },
            { label: "Embedded objects",      tokens: chartTokens,    color: "#16a34a" },
            { label: "Presentation settings", tokens: t.presentation, color: "#92400e" },
          ].filter((s) => s.tokens > 0);
          $("#cv-bar1-label", root).textContent = "PPTX input";
          ns.renderSegBar($("#cv-bar1", root), segs, beforeTokens);
          const fmtTokens = Math.max(0, afterTokens - plainTokens);
          const mdSegs = [{ label: "Plain text", tokens: plainTokens, color: "#2563eb" }];
          if (fmtTokens > 0) mdSegs.push({ label: "Markdown formatting", tokens: fmtTokens, color: "#d97706" });
          ns.renderSegBar($("#cv-bar2", root), mdSegs, afterTokens);
          $("#cv-bar2-row", root).hidden = false;
          breakdown.hidden = false;
        } else {
          breakdown.hidden = true;
        }
      }

      // -- PDF pipeline --

      async function convertPdf() {
        run.textContent = "Extracting text…";
        const { pages, rawText, pageCount } = await ns.extractPdf(await file.arrayBuffer());
        if (!rawText.trim()) {
          fail("No text layer was found in this PDF — it appears to be scanned or image-only. OCR for PDFs is not supported yet.");
          run.textContent = "Try again"; return;
        }
        const content = ns.pdfMarkdown(pages);
        output = { content, mime: "text/markdown", name: `${file.name.replace(/\.pdf$/i, "")}.md` };
        const outBytes = new Blob([content]).size;

        let textTokens = null, afterTokens = null, plainTokens = null, tokenCountError = false;
        try {
          [textTokens, afterTokens, plainTokens] = await Promise.all([
            ns.countTokens(rawText),
            ns.countTokens(content),
            ns.countTokens(ns.plainTextOfMarkdown(content)),
          ]);
        } catch { tokenCountError = true; }

        pdfState = tokenCountError ? null : { pages, textTokens, afterTokens, plainTokens, content, outBytes };
        if (pdfState) {
          recomputePdf();
        } else {
          const caveat = `Token counts are local estimates. The local tokenizer could not load, so no token estimate is shown.`;
          populateResults({
            beforeLabel: "PDF",
            beforeTokensText: "Token estimate unavailable",
            caveat,
            content, outBytes, beforeTokens: null, afterTokens: null, tokenCountError,
          });
          $("#cv-pdf-caveat", root).innerHTML = caveat;
          $("#cv-breakdown", root).hidden = true;
        }
        $("#cv-messages", root).textContent =
          `${pageCount} page${pageCount === 1 ? "" : "s"} extracted. Review the preview — headings, tables, and reading order are best-effort heuristics.`;
      }

      // Rebuilds the "before" estimate and both breakdown bars from cached
      // page dimensions/token counts. Called on conversion and whenever the
      // token-estimate-settings model dropdown changes — no re-extraction
      // needed since only the image-token half of the estimate depends on it.
      function recomputePdf() {
        if (!pdfState) return;
        const { pages, textTokens, afterTokens, plainTokens, content, outBytes } = pdfState;
        const model = ns.IMAGE_TOKEN_MODELS.find((m) => m.id === pdfModelEl.value) || ns.IMAGE_TOKEN_MODELS[0];
        const imageTokens = pages.reduce((sum, p) => sum + ns.estimatePdfPageImageTokens(p.width, p.height, model.id), 0);
        const beforeTokens = textTokens + imageTokens;
        const caveat = `Token counts are local estimates. The &ldquo;before&rdquo; figure combines this tool's naive text extraction (<code>o200k_base</code>, ${number(textTokens)} tokens — includes repeated headers, footers, and page numbers) with an estimated image-token cost for <strong>${escapeHtml(model.short)}</strong> (${number(imageTokens)} tokens, from each page's dimensions rendered at an assumed 150 DPI &mdash; providers don&rsquo;t publish the resolution they actually rasterize PDF pages at). The Markdown side is a plain <code>o200k_base</code> text count; it strips repeated headers/footers/page numbers but adds its own structural syntax (headings, lists, tables), so the token count doesn't always go down.`;

        populateResults({
          beforeLabel: "PDF",
          beforeTokensText: `${number(beforeTokens)} tokens`,
          caveat,
          content, outBytes, beforeTokens, afterTokens, tokenCountError: false,
        });
        $("#cv-pdf-caveat", root).innerHTML = caveat;

        const segs1 = [
          { label: "Extracted text",                    tokens: textTokens, color: "#2563eb" },
          { label: `Page images (${model.short})`,       tokens: imageTokens, color: "#d97706" },
        ].filter((s) => s.tokens > 0);
        $("#cv-bar1-label", root).textContent = "Raw PDF upload (estimated)";
        ns.renderSegBar($("#cv-bar1", root), segs1, beforeTokens);

        const fmtTokens = Math.max(0, afterTokens - plainTokens);
        const segs2 = [{ label: "Plain text", tokens: plainTokens, color: "#2563eb" }];
        if (fmtTokens > 0) segs2.push({ label: "Markdown formatting", tokens: fmtTokens, color: "#d97706" });
        ns.renderSegBar($("#cv-bar2", root), segs2, afterTokens);
        $("#cv-bar2-row", root).hidden = false;
        $("#cv-breakdown", root).hidden = false;
      }

      const PIPELINES = {
        docx:  { fn: convertDocx,  busyLabel: "Converting…",       errorMsg: "This document could not be converted. Make sure it is a valid, unencrypted .docx file." },
        pptx:  { fn: convertPptx,  busyLabel: "Converting…",       errorMsg: "This presentation could not be converted. Make sure it is a valid, unencrypted .pptx file." },
        pdf:   { fn: convertPdf,   busyLabel: "Extracting…",       errorMsg: "This PDF could not be processed. Make sure it is a valid, unencrypted PDF file." },
        html:  { fn: convertHtml,  busyLabel: "Extracting…",       errorMsg: "This file could not be processed. Make sure it is a valid HTML file." },
        image: { fn: convertImage, busyLabel: "Preparing OCR…",    errorMsg: "This image could not be processed. Make sure it is a valid .png, .jpg, or .webp file, and check your connection — the OCR library loads on first use." },
      };

      async function convert() {
        if (!file || busy) return;
        const pipeline = PIPELINES[fileType];
        busy = true; fail(""); run.disabled = true;
        run.textContent = pipeline.busyLabel;
        try {
          await pipeline.fn();
        } catch (err) {
          console.error(err);
          fail(pipeline.errorMsg);
          run.textContent = "Try again";
        } finally { busy = false; run.disabled = !file; }
      }

      run.addEventListener("click", convert);
      copy.addEventListener("click", () => output && copyWithFeedback(copy, () => output.content));
      download.addEventListener("click", () => output && save(output.content, output.name, output.mime));

      // Live recalculation: PPTX toggles rebuild both sides from cached counts;
      // the vision-model dropdown recalculates only the image baseline.
      pptxTogglesEl.addEventListener("change", async () => {
        if (fileType !== "pptx" || !pptxState || busy) return;
        busy = true;
        try { await recomputePptx(); } catch (err) { console.error(err); } finally { busy = false; }
      });
      imageModelEl.addEventListener("change", updateImageBaseline);
      pdfModelEl.addEventListener("change", () => { if (fileType === "pdf" && pdfState) recomputePdf(); });

      return { setFile, reset, restoreSession };
  };
})();
