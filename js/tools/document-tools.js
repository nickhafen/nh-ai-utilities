// Document Tools: the persistent-rail shell that hosts three workflows —
// Convert to Markdown (js/tools/document-converter.js), Extract URLs, and
// Check AI Indicators (both js/tools/analyzer.js) — under one document. The
// rail owns document intake (a file OR pasted text) and, for the two
// link-based workflows, extracts links once and hands the same list to both,
// so switching workflows never requires re-uploading or re-pasting.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, $$, escapeHtml } = ns;

  const WORKFLOWS = [
    {
      id: "convert",
      label: "Convert to Markdown",
      sub: "Token savings estimate",
      formats: ["docx", "html", "pdf", "pptx", "image"],
    },
    {
      id: "extract-urls",
      label: "Extract URLs",
      sub: "List and copy every link",
      formats: ["docx", "html", "pdf", "pptx", "paste"],
    },
    {
      id: "ai-indicators",
      label: "Check Links for  AI Indicators",
      sub: "AI tags & unreachable links",
      formats: ["docx", "html", "pdf", "pptx", "paste"],
    },
  ];

  const TYPE_ICON = { docx: "DOCX", pptx: "PPTX", pdf: "PDF", html: "HTML", image: "IMAGE", paste: "TXT" };
  const FORMAT_LABEL = { docx: "DOCX", pptx: "PPTX", pdf: "PDF", html: "HTML", image: "IMG", paste: "PASTE" };

  const FILE_ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
    ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation," +
    ".pdf,application/pdf,.html,.htm,text/html," +
    ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";

  const bytes = (n) => {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    const p = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
    const v = n / (1024 ** p);
    return `${v.toFixed(p === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[p]}`;
  };

  // ── Paste-area helpers (safe rich-text insertion) ─────────────────────────
  //
  // The paste box is a contenteditable div rather than a <textarea> so that
  // pasting rich text (e.g. copying an article from a web page) keeps its
  // hyperlinks — a plain textarea always degrades paste to bare text, which
  // loses both anchor hrefs and anchor text.

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
      const href = ns.cleanUrl(node.getAttribute("href") || "");
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
    node.childNodes.forEach((c) => sanitizeNode(c, frag));
    if (BLOCK.has(tag)) {
      if (!frag.lastChild || frag.lastChild.nodeValue !== "\n") frag.appendChild(document.createTextNode("\n"));
    }
  }

  function htmlToFragment(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const frag = document.createDocumentFragment();
    doc.body.childNodes.forEach((n) => sanitizeNode(n, frag));
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

  // Extracts a deduped, cleaned link list from pasted content. When HTML is
  // available (rich-text paste), anchor hrefs and anchor text are used;
  // bare URLs found in the text (HTML or plain) are also picked up.
  function extractFromPaste(html, plain) {
    const seen = new Set();
    const links = [];
    function add(visibleText, url) {
      const clean = ns.cleanUrl(url);
      if (!clean || clean.startsWith("#") || seen.has(clean)) return;
      seen.add(clean);
      links.push({ visibleText: (visibleText || clean).trim(), url: clean });
    }
    if (html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("a[href]").forEach((a) => {
        const href = ns.cleanUrl(a.getAttribute("href") || "");
        if (href) add(a.textContent, href);
      });
      for (const u of ns.extractUrls(doc.body.textContent || "")) add(u, u);
    }
    for (const u of ns.extractUrls(plain || "")) add(u, u);
    return links;
  }

  function extractFromEditor(editor) {
    return extractFromPaste(editor.innerHTML, editor.textContent);
  }

  const IMAGE_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

  // Wraps a clipboard image Blob as a File so it can flow through the same
  // applyFile() path as a dropped/chosen file, giving it an extension
  // detectDocumentFileType() recognizes (it sniffs by filename, not MIME).
  function imageBlobToFile(blob) {
    const ext = IMAGE_EXT[blob.type] || "png";
    return new File([blob], `pasted-image.${ext}`, { type: blob.type });
  }

  function pasteAreaLabel(editor) {
    const first = (editor.textContent || "").trim().split("\n")[0].trim();
    const preview = first.slice(0, 60);
    return `Pasted text: "${preview}${preview.length < first.length ? "…" : ""}"`;
  }

  // Set by render(); the registered tool's onShow calls whichever handler the
  // active render() instance last installed, mirroring the persist:true
  // pattern used elsewhere in this app.
  let handleShow = null;

  ns.registerTool({
    id: "document-tools",
    name: "Document Tools",
    description: "Convert, analyze, and check documents — add a file once and run any workflow against it",
    persist: true,
    onShow() {
      if (handleShow) handleShow();
    },
    render(root) {
      let file = null, fileType = null, activeWorkflow = null;

      root.innerHTML = `
        <section class="tool-view doctools-tool">
          <section class="panel doctools-intro">
            <div class="panel-header converter-intro-header">
              <div>
                <span class="panel-title">Document Tools</span>
                <p class="cp-subtitle">Add a document once, then run any workflow below against it &mdash; convert to Markdown, check links for AI-tracking tags, and more.</p>
              </div>
              
            </div>
          </section>

          <div class="doctools-shell">
            <aside class="doctools-rail">
              <div>
                <div class="dt-rail-heading">Document</div>

                <div id="dt-active-doc" class="doctools-file-card" hidden>
                  <div class="doctools-file-top">
                    <span id="dt-file-icon" class="drop-icon">DOCX</span>
                    <div class="doctools-file-meta-wrap">
                      <div id="dt-file-name" class="doctools-file-name" title=""></div>
                      <div id="dt-file-meta" class="doctools-file-meta"></div>
                    </div>
                  </div>
                  <div class="doctools-file-actions">
                    <button id="dt-remove" class="btn btn-subtle btn-sm" type="button">Clear document</button>
                  </div>
                </div>

                <div id="dt-dropzone" class="drop-area doctools-rail-drop" role="button" tabindex="0" aria-label="Choose a file">
                  <span class="drop-icon">FILE</span>
                  <strong class="primary-text" style="font-size:.82rem">Drop a file here</strong>
                  <span class="hint">.docx, .pptx, .pdf, .html, image &mdash; or click to choose</span>
                  <input id="dt-file-input" type="file" accept="${FILE_ACCEPT}" hidden>
                </div>
                <p id="dt-rail-error" class="converter-error" role="alert" hidden></p>

                <div class="doctools-rail-divider"><span>or</span></div>

                <div class="doctools-paste-block">
                  <div class="doctools-paste-label-row">
                    <label class="paste-label" for="dt-paste-area">Paste text</label>
                    <button id="dt-paste-clipboard" class="btn btn-subtle btn-sm doctools-clipboard-btn" type="button">Paste from clipboard</button>
                  </div>
                  <div
                    id="dt-paste-area"
                    class="rich-input doctools-paste-area"
                    contenteditable="true"
                    role="textbox"
                    aria-multiline="true"
                    data-placeholder="Paste text here…"
                  ></div>
                  <button id="dt-paste-apply" class="btn btn-secondary btn-sm doctools-paste-btn" type="button">Use pasted text</button>
                </div>
              </div>

              <div>
                <div class="dt-rail-heading">Workflows</div>
                <p class="doctools-rail-legend">Chips show which inputs each workflow accepts.</p>
                <div id="dt-workflow-list" class="doctools-workflow-list">
                  ${WORKFLOWS.map((wf) => `
                    <button class="doctools-workflow-item" type="button" data-workflow="${wf.id}" aria-selected="false" disabled>
                      <span class="doctools-workflow-body">
                        <strong>${escapeHtml(wf.label)}</strong>
                        <small>${escapeHtml(wf.sub)}</small>
                        <span class="doctools-workflow-formats">
                          ${wf.formats.map((f) => `<span class="doctools-format-chip" data-format="${f}">${FORMAT_LABEL[f]}</span>`).join("")}
                        </span>
                        <p class="doctools-workflow-note" data-workflow-note hidden></p>
                      </span>
                    </button>
                  `).join("")}
                </div>
              </div>
            </aside>

            <div id="dt-main" class="doctools-main">
              <div data-doctools-view="placeholder" class="doctools-placeholder is-active">
                <div>
                  <div class="doctools-placeholder-mark">Aa</div>
                  <strong>No document yet</strong>
                  <p>Add a file or paste text on the left, then pick a workflow to run against it.</p>
                </div>
              </div>
              <div data-doctools-view="convert" class="doctools-workflow-mount"></div>
              <div data-doctools-view="extract-urls" class="doctools-workflow-mount"></div>
              <div data-doctools-view="ai-indicators" class="doctools-workflow-mount"></div>
            </div>
          </div>
        </section>`;

      const dropzone    = $("#dt-dropzone", root);
      const fileInput    = $("#dt-file-input", root);
      const activeDoc    = $("#dt-active-doc", root);
      const removeBtn    = $("#dt-remove", root);
      const pasteArea    = $("#dt-paste-area", root);
      const pasteApplyBtn = $("#dt-paste-apply", root);
      const pasteClipboardBtn = $("#dt-paste-clipboard", root);
      const railError    = $("#dt-rail-error", root);
      const railFail     = (message) => { railError.textContent = message; railError.hidden = !message; };

      const convertApi    = ns.mountConvertWorkflow($('[data-doctools-view="convert"]', root));
      const extractApi    = ns.mountExtractUrlsWorkflow($('[data-doctools-view="extract-urls"]', root));
      const indicatorsApi = ns.mountAiIndicatorsWorkflow($('[data-doctools-view="ai-indicators"]', root));

      function workflowButton(id) {
        return $(`[data-workflow="${id}"]`, root);
      }

      function isEnabled(wf) {
        return !!fileType && wf.formats.includes(fileType);
      }

      function updateWorkflowAvailability() {
        WORKFLOWS.forEach((wf) => {
          const btn = workflowButton(wf.id);
          const note = $("[data-workflow-note]", btn);
          const enabled = isEnabled(wf);
          btn.disabled = !enabled;
          if (fileType && !enabled) {
            note.textContent = fileType === "paste"
              ? "Doesn't support pasted text — add a file instead."
              : "Not available for this file type.";
            note.hidden = false;
          } else {
            note.hidden = true;
          }
          $$(".doctools-format-chip", btn).forEach((chip) => {
            chip.classList.toggle("is-match", !!fileType && chip.dataset.format === fileType);
            chip.classList.toggle("is-mismatch", !!fileType && chip.dataset.format !== fileType);
          });
        });
      }

      function showPlaceholder() {
        activeWorkflow = null;
        $$("[data-workflow]", root).forEach((btn) => btn.setAttribute("aria-selected", "false"));
        $$("[data-doctools-view]", root).forEach((el) => el.classList.toggle("is-active", el.dataset.doctoolsView === "placeholder"));
      }

      function selectWorkflow(id) {
        activeWorkflow = id;
        $$("[data-workflow]", root).forEach((btn) => btn.setAttribute("aria-selected", String(btn.dataset.workflow === id)));
        $$("[data-doctools-view]", root).forEach((el) => el.classList.toggle("is-active", el.dataset.doctoolsView === id));
      }

      // Picks the first workflow the current document supports (WORKFLOWS is
      // ordered by priority: Convert first, since it supports every file
      // format; the link workflows are the fallback for pasted text).
      function autoSelectWorkflow() {
        const wf = WORKFLOWS.find((w) => isEnabled(w));
        if (wf) selectWorkflow(wf.id); else showPlaceholder();
      }

      // Called after a document is added/replaced. Keeps whichever workflow
      // the user already had open if it still accepts the new document, so
      // running a batch of files through the same workflow never bounces
      // back to Convert (the first, always-enabled workflow) on every add.
      // Only auto-selects when nothing was active or the prior pick no
      // longer applies (e.g. switching from a .docx to a .pptx).
      function keepOrAutoSelectWorkflow() {
        const current = WORKFLOWS.find((w) => w.id === activeWorkflow);
        if (current && isEnabled(current)) { selectWorkflow(current.id); return; }
        autoSelectWorkflow();
      }

      function distributeLinks(links, label) {
        extractApi.setLinks(links, label);
        indicatorsApi.setLinks(links, label);
      }

      function setActiveDocDisplay(icon, name, meta) {
        $("#dt-file-icon", root).textContent = icon;
        $("#dt-file-name", root).textContent = name;
        $("#dt-file-name", root).title = name;
        $("#dt-file-meta", root).textContent = meta;
        activeDoc.hidden = false;
      }

      async function applyFile(selected) {
        if (!selected) return;
        const type = ns.detectDocumentFileType(selected);
        if (!type) {
          railFail("Please choose a .docx, .pptx, .pdf, .html/.htm, or image (.png, .jpg, .webp) file.");
          return;
        }
        railFail("");
        pasteArea.innerHTML = "";
        file = selected; fileType = type;
        setActiveDocDisplay(TYPE_ICON[type], file.name, bytes(file.size));

        convertApi.setFile(file, type);

        if (type === "docx") {
          if (!window.JSZip) {
            railFail("The document reader did not load. Check your connection and refresh.");
          } else {
            try {
              const zip = await JSZip.loadAsync(await file.arrayBuffer());
              const links = await ns.extractDocxLinks(zip);
              distributeLinks(links, file.name);
            } catch {
              railFail("Could not read the file for link extraction. Make sure it is a valid .docx.");
              distributeLinks([], file.name);
            }
          }
        } else if (type === "html") {
          try {
            const text = await file.text();
            distributeLinks(extractFromPaste(text, ""), file.name);
          } catch {
            railFail("Could not read the file for link extraction. Make sure it is a valid HTML file.");
            distributeLinks([], file.name);
          }
        } else if (type === "pdf") {
          try {
            const links = await ns.extractPdfLinks(await file.arrayBuffer());
            distributeLinks(links, file.name);
          } catch {
            railFail("Could not read the file for link extraction. Make sure it is a valid PDF.");
            distributeLinks([], file.name);
          }
        } else if (type === "pptx") {
          if (!window.JSZip) {
            railFail("The document reader did not load. Check your connection and refresh.");
          } else {
            try {
              const zip = await JSZip.loadAsync(await file.arrayBuffer());
              const links = await ns.extractPptxLinks(zip);
              distributeLinks(links, file.name);
            } catch {
              railFail("Could not read the file for link extraction. Make sure it is a valid .pptx.");
              distributeLinks([], file.name);
            }
          }
        } else {
          extractApi.reset();
          indicatorsApi.reset();
        }

        updateWorkflowAvailability();
        keepOrAutoSelectWorkflow();
      }

      function applyPaste() {
        const text = pasteArea.textContent.trim();
        if (!text) { pasteArea.focus(); return; }
        railFail("");
        fileInput.value = "";
        file = null; fileType = "paste";

        setActiveDocDisplay("TXT", pasteAreaLabel(pasteArea), `${text.length} character${text.length === 1 ? "" : "s"}`);

        convertApi.reset();
        const links = extractFromEditor(pasteArea);
        distributeLinks(links, $("#dt-file-name", root).textContent);
        pasteArea.innerHTML = "";

        updateWorkflowAvailability();
        keepOrAutoSelectWorkflow();
      }

      function clearDocument() {
        file = null; fileType = null;
        pasteArea.innerHTML = "";
        fileInput.value = "";
        activeDoc.hidden = true;
        convertApi.reset();
        extractApi.reset();
        indicatorsApi.reset();
        updateWorkflowAvailability();
        showPlaceholder();
      }

      dropzone.addEventListener("click", () => fileInput.click());
      dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
      ["dragenter", "dragover"].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); }));
      ["dragleave", "drop"].forEach((t) => dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.remove("drag-over"); }));
      dropzone.addEventListener("drop", (e) => applyFile(e.dataTransfer.files[0]));
      fileInput.addEventListener("change", () => applyFile(fileInput.files[0]));
      pasteArea.addEventListener("paste", (e) => {
        const cb = e.clipboardData;
        const imageFile = Array.from(cb.files || []).find((f) => f.type.startsWith("image/"));
        if (imageFile) {
          e.preventDefault();
          applyFile(imageFile);
          return;
        }
        e.preventDefault();
        const html = cb.getData("text/html");
        const plain = cb.getData("text/plain");
        const frag = html
          ? htmlToFragment(html)
          : (() => { const f = document.createDocumentFragment(); f.appendChild(document.createTextNode(plain)); return f; })();
        insertAtCursor(pasteArea, frag);
      });
      async function pasteFromClipboard() {
        try {
          let frag = null;
          if (navigator.clipboard && navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            let html = "", plain = "", imageType = null;
            for (const item of items) {
              imageType = item.types.find((t) => t.startsWith("image/")) || imageType;
              if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
              if (item.types.includes("text/plain")) plain = await (await item.getType("text/plain")).text();
            }
            if (imageType && !html && !plain) {
              const item = items.find((it) => it.types.includes(imageType));
              const blob = await item.getType(imageType);
              await applyFile(imageBlobToFile(blob));
              return;
            }
            if (!html && !plain) throw new Error("empty");
            frag = html
              ? htmlToFragment(html)
              : (() => { const f = document.createDocumentFragment(); f.appendChild(document.createTextNode(plain)); return f; })();
          } else if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (!text) throw new Error("empty");
            frag = document.createDocumentFragment();
            frag.appendChild(document.createTextNode(text));
          } else {
            throw new Error("unsupported");
          }
          insertAtCursor(pasteArea, frag);
          railFail("");
        } catch {
          railFail("Couldn't read the clipboard — your browser may need permission, or try Ctrl+V in the box instead.");
        }
      }

      pasteApplyBtn.addEventListener("click", applyPaste);
      pasteClipboardBtn.addEventListener("click", pasteFromClipboard);
      removeBtn.addEventListener("click", clearDocument);

      $("#dt-workflow-list", root).addEventListener("click", (e) => {
        const btn = e.target.closest("[data-workflow]");
        if (!btn || btn.disabled) return;
        selectWorkflow(btn.dataset.workflow);
      });

      updateWorkflowAvailability();

      // History restores a saved session by setting a pending-session global
      // and switching to this tool's hash; onShow (fired on every activation,
      // including this one) picks it up and routes it to the right workflow.
      handleShow = () => {
        if (ns.pendingConverterSession) {
          const s = ns.pendingConverterSession;
          ns.pendingConverterSession = null;
          selectWorkflow("convert");
          convertApi.restoreSession(s);
        } else if (ns.pendingSession) {
          const s = ns.pendingSession;
          ns.pendingSession = null;
          selectWorkflow("ai-indicators");
          indicatorsApi.restoreSession(s);
        }
      };
    },
  });
})();
