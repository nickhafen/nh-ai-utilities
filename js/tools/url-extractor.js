(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml, extractUrls, formatUrls, copyText } = ns;

  const BLOCK_TAGS = new Set([
    "address",
    "article",
    "aside",
    "blockquote",
    "div",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
  ]);

  function appendText(fragment, text) {
    if (!text) return;
    fragment.appendChild(document.createTextNode(text));
  }

  function appendLineBreak(fragment) {
    const last = fragment.lastChild;
    if (!last || last.nodeValue === "\n") return;
    fragment.appendChild(document.createTextNode("\n"));
  }

  function appendSanitizedNode(node, fragment) {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(fragment, node.nodeValue);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    if (tag === "br") {
      appendLineBreak(fragment);
      return;
    }

    if (tag === "a") {
      const href = ns.cleanUrl(node.getAttribute("href") || "");
      const label = node.textContent || href;

      if (href) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.textContent = label;
        anchor.tabIndex = -1;
        fragment.appendChild(anchor);
      } else {
        appendText(fragment, label);
      }
      return;
    }

    node.childNodes.forEach((child) => appendSanitizedNode(child, fragment));

    if (BLOCK_TAGS.has(tag)) {
      appendLineBreak(fragment);
    }
  }

  function htmlToSafeFragment(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const fragment = document.createDocumentFragment();
    doc.body.childNodes.forEach((node) => appendSanitizedNode(node, fragment));
    return fragment;
  }

  function textToFragment(text) {
    const fragment = document.createDocumentFragment();
    appendText(fragment, text);
    return fragment;
  }

  function insertFragment(editor, fragment) {
    editor.focus();

    const marker = document.createTextNode("");
    fragment.appendChild(marker);

    const selection = window.getSelection();
    let range = selection.rangeCount ? selection.getRangeAt(0) : null;

    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }

    range.deleteContents();
    range.insertNode(fragment);
    range.setStartAfter(marker);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    marker.remove();
  }

  ns.registerTool({
    id: "url-extractor",
    name: "NotebookLM URL Extractor",
    description: "Extract copy-ready URLs from pasted text.",
    render(root) {
      let urls = [];
      let outputFormat = "lines";

      root.innerHTML = `
        <div class="tool-heading">
          <div>
            <h2>NotebookLM URL Extractor</h2>
            <p>Paste syllabus text, then copy the source URLs in the format NotebookLM accepts.</p>
          </div>
        </div>

        <div class="utility-grid">
          <section class="card">
            <div class="field">
              <label for="source-text">Source text</label>
              <div
                id="source-text"
                class="text-input rich-input"
                data-source-text
                contenteditable="true"
                role="textbox"
                aria-multiline="true"
                data-placeholder="Paste syllabus text, copied Google Docs or Word content, website text, or markdown here"
              ></div>
            </div>
            <div class="reset-row">
              <button class="btn btn-secondary" data-clear>Clear</button>
            </div>
          </section>

          <section class="card">
            <div class="section-head">
              <h3>Extracted URLs</h3>
              <span class="count-pill" data-count>0 found</span>
            </div>

            <div class="actions-row">
              <div class="segmented" role="group" aria-label="Output format">
                <button data-format="lines" aria-pressed="true">Lines</button>
                <button data-format="commas" aria-pressed="false">Commas</button>
              </div>
              <button class="btn btn-primary" data-copy disabled>Copy URLs</button>
            </div>

            <div class="field output-field">
              <label for="url-output">Output</label>
              <textarea id="url-output" class="textarea output" data-url-output readonly></textarea>
            </div>
            <p class="status-note" data-status>Paste text to begin.</p>
            <ol class="url-list" data-url-list></ol>
          </section>
        </div>
      `;

      const sourceText = $("[data-source-text]", root);
      const urlOutput = $("[data-url-output]", root);
      const urlList = $("[data-url-list]", root);
      const count = $("[data-count]", root);
      const copyButton = $("[data-copy]", root);
      const clearButton = $("[data-clear]", root);
      const status = $("[data-status]", root);

      function outputText() {
        return formatUrls(urls, outputFormat === "commas" ? "commas" : "lines");
      }

      function renderUrls() {
        const text = outputText();
        urlOutput.value = text;
        count.textContent = `${urls.length} found`;
        copyButton.disabled = urls.length === 0;

        if (!sourceText.textContent.trim() && !sourceText.querySelector("a[href]")) {
          status.textContent = "Paste text to begin.";
        } else if (!urls.length) {
          status.textContent = "No URLs found.";
        } else {
          status.textContent = outputFormat === "commas"
            ? "Comma-separated output is ready."
            : "Line-separated output is ready.";
        }

        urlList.innerHTML = urls.map((url) => `<li>${escapeHtml(url)}</li>`).join("");
      }

      function update() {
        urls = extractUrls(`${sourceText.innerHTML}\n${sourceText.textContent}`);
        renderUrls();
      }

      sourceText.addEventListener("input", update);
      sourceText.addEventListener("paste", (event) => {
        event.preventDefault();

        const clipboard = event.clipboardData;
        const html = clipboard.getData("text/html");
        const plain = clipboard.getData("text/plain");
        const fragment = html ? htmlToSafeFragment(html) : textToFragment(plain);

        insertFragment(sourceText, fragment);
        update();
      });
      clearButton.addEventListener("click", () => {
        sourceText.innerHTML = "";
        update();
        sourceText.focus();
      });
      copyButton.addEventListener("click", async () => {
        if (!urls.length) return;

        await copyText(outputText());
        status.textContent = `Copied ${urls.length} URL${urls.length === 1 ? "" : "s"}.`;
      });
      root.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-format]");
        if (!button) return;

        outputFormat = button.dataset.format;
        root.querySelectorAll("button[data-format]").forEach((formatButton) => {
          formatButton.setAttribute("aria-pressed", String(formatButton === button));
        });
        renderUrls();
      });

      renderUrls();
    },
  });
})();
