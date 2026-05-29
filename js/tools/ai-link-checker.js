(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml, highlightMatches } = ns;

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

  ns.registerTool({
    id: "ai-link-checker",
    name: "AI Link Checker",
    description: "Scan .docx files for AI platform URL tags.",
    render(root) {
      let tags = [...DEFAULT_TAGS];
      let loadedZip = null;
      let loadedFilename = "";

      root.innerHTML = `
        <div class="tool-heading">
          <div>
            <h2>AI Link Checker</h2>
            <p>Scan .docx hyperlinks and visible text for AI platform tracking tags.</p>
          </div>
        </div>

        <section class="card">
          <h3>Tags to detect</h3>
          <div class="tags-row" data-tags-list></div>
          <div class="add-row">
            <input class="text-input" data-tag-input type="text" placeholder="e.g. utm_source=claude.ai">
            <button class="btn btn-primary" data-add-tag>Add</button>
          </div>
        </section>

        <section class="card" data-drop-card>
          <div class="drop-area" data-drop-area>
            <div class="drop-icon" aria-hidden="true">DOCX</div>
            <p class="primary-text">Drop a <strong>.docx</strong> file here, or click to browse</p>
            <p class="hint">Your file stays in this browser.</p>
          </div>
          <input data-file-input type="file" accept=".docx" hidden>
        </section>

        <section class="card" data-results-card hidden>
          <div data-results-content></div>
          <div class="reset-row">
            <button class="btn btn-primary" data-rerun>Re-run search</button>
            <button class="btn btn-secondary" data-reset>Check another file</button>
          </div>
        </section>
      `;

      const tagsList = $("[data-tags-list]", root);
      const tagInput = $("[data-tag-input]", root);
      const addTagButton = $("[data-add-tag]", root);
      const dropCard = $("[data-drop-card]", root);
      const dropArea = $("[data-drop-area]", root);
      const fileInput = $("[data-file-input]", root);
      const resultsCard = $("[data-results-card]", root);
      const resultsContent = $("[data-results-content]", root);
      const rerunButton = $("[data-rerun]", root);
      const resetButton = $("[data-reset]", root);

      function renderTags() {
        tagsList.innerHTML = tags.map((tag, index) => `
          <span class="tag-chip">
            ${escapeHtml(tag)}
            <button data-tag-index="${index}" title="Remove ${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">x</button>
          </span>
        `).join("");
      }

      function addTag() {
        const value = tagInput.value.trim();
        if (value && !tags.includes(value)) {
          tags.push(value);
          renderTags();
        }
        tagInput.value = "";
        tagInput.focus();
      }

      async function processFile(file) {
        if (!file.name.toLowerCase().endsWith(".docx")) {
          alert("Please select a .docx file.");
          return;
        }

        if (!window.JSZip) {
          alert("The document reader did not load. Check your connection and refresh the page.");
          return;
        }

        try {
          loadedZip = await JSZip.loadAsync(await file.arrayBuffer());
          loadedFilename = file.name;
          await runScan();
        } catch {
          alert("Could not read the file. Make sure it is a valid .docx.");
        }
      }

      async function runScan() {
        if (!loadedZip) return;

        if (!tags.length) {
          alert("Add at least one tag to search for.");
          return;
        }

        const results = [];
        const seenUrls = new Set();

        for (const [relsPath, relsEntry] of Object.entries(loadedZip.files)) {
          if (relsEntry.dir || !relsPath.endsWith(".rels")) continue;

          const relsMatch = relsPath.match(/^(.*)\/_rels\/(.+)\.rels$/);
          if (!relsMatch) continue;

          const xmlPath = `${relsMatch[1]}/${relsMatch[2]}`;
          const xmlEntry = loadedZip.files[xmlPath];
          if (!xmlEntry) continue;

          let relsText = "";
          let xmlText = "";

          try {
            relsText = (await relsEntry.async("string")).replace(/&amp;/g, "&");
            xmlText = (await xmlEntry.async("string")).replace(/&amp;/g, "&");
          } catch {
            continue;
          }

          const urlMap = {};
          for (const rel of relsText.match(/<Relationship\b[^>]*>/g) || []) {
            const type = (rel.match(/Type="([^"]+)"/) || [])[1] || "";
            const id = (rel.match(/\bId="([^"]+)"/) || [])[1];
            const target = (rel.match(/Target="([^"]+)"/) || [])[1];
            if (type.endsWith("/hyperlink") && id && target) {
              urlMap[id] = target;
            }
          }

          if (Object.keys(urlMap).length) {
            const hyperlinkRe = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g;
            for (const hyperlinkMatch of xmlText.matchAll(hyperlinkRe)) {
              const attrs = hyperlinkMatch[1];
              const body = hyperlinkMatch[2];
              const rIdMatch = attrs.match(/r:id="([^"]+)"/) ||
                attrs.match(/\w+:id="(rId[^"]+)"/);
              const rId = rIdMatch ? rIdMatch[1] : null;
              const url = rId && urlMap[rId] ? urlMap[rId] : "";

              if (!url || url.startsWith("#")) continue;

              const visibleText = [...body.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
                .map((textMatch) => textMatch[1])
                .join("");

              const urlMatches = tags.filter((tag) => url.toLowerCase().includes(tag.toLowerCase()));
              const textMatches = tags.filter((tag) => visibleText.toLowerCase().includes(tag.toLowerCase()));

              if (urlMatches.length || textMatches.length) {
                results.push({ visibleText, url, urlMatches, textMatches });
                seenUrls.add(url);
              }
            }
          }

          const strippedXml = xmlText.replace(/<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/g, "");
          for (const textMatch of strippedXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) {
            const text = textMatch[1];
            const textMatches = tags.filter((tag) => text.toLowerCase().includes(tag.toLowerCase()));
            if (textMatches.length) {
              results.push({ visibleText: text, url: "", urlMatches: [], textMatches });
            }
          }
        }

        for (const [name, entry] of Object.entries(loadedZip.files)) {
          if (entry.dir || !name.endsWith(".rels")) continue;

          try {
            const relsText = (await entry.async("string")).replace(/&amp;/g, "&");
            for (const tag of tags) {
              if (!relsText.toLowerCase().includes(tag.toLowerCase())) continue;

              const targetRe = new RegExp(`Target="([^"]*${ns.escapeRegExp(tag)}[^"]*)"`, "gi");
              for (const fallbackMatch of relsText.matchAll(targetRe)) {
                const url = fallbackMatch[1];
                if (!seenUrls.has(url)) {
                  results.push({ visibleText: "", url, urlMatches: [tag], textMatches: [] });
                  seenUrls.add(url);
                }
              }
            }
          } catch {
            // Skip unreadable relationship parts.
          }
        }

        showResults(results);
      }

      function showResults(results) {
        if (!results.length) {
          resultsContent.innerHTML = `
            <div class="clean">
              <div class="clean-icon" aria-hidden="true">OK</div>
              <p>No matching tags found in <strong>${escapeHtml(loadedFilename)}</strong></p>
            </div>
          `;
        } else {
          results.sort((a, b) => {
            const rank = (result) =>
              (result.urlMatches.length && !result.textMatches.length) ? 0 :
              (result.urlMatches.length && result.textMatches.length) ? 1 : 2;
            return rank(a) - rank(b);
          });

          const rows = results.map((result) => `
            <tr>
              <td class="col-text">
                ${result.visibleText
                  ? highlightMatches(result.visibleText, result.textMatches)
                  : '<span class="empty">None</span>'}
              </td>
              <td class="col-url">
                ${result.url
                  ? highlightMatches(result.url, result.urlMatches)
                  : '<span class="empty">None</span>'}
              </td>
            </tr>
          `).join("");

          resultsContent.innerHTML = `
            <div class="summary">
              <span class="summary-icon" aria-hidden="true">!</span>
              <div>
                <strong>${results.length} instance${results.length === 1 ? "" : "s"} found</strong><br>
                <span class="fname">${escapeHtml(loadedFilename)}</span>
              </div>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Visible Text</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
        }

        dropCard.hidden = true;
        resultsCard.hidden = false;
        resultsCard.scrollIntoView({ behavior: "smooth" });
      }

      addTagButton.addEventListener("click", addTag);
      tagInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") addTag();
      });
      tagsList.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-tag-index]");
        if (!button) return;
        tags.splice(Number(button.dataset.tagIndex), 1);
        renderTags();
      });

      dropArea.addEventListener("click", () => fileInput.click());
      dropArea.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropArea.classList.add("drag-over");
      });
      dropArea.addEventListener("dragleave", () => dropArea.classList.remove("drag-over"));
      dropArea.addEventListener("drop", (event) => {
        event.preventDefault();
        dropArea.classList.remove("drag-over");
        if (event.dataTransfer.files[0]) processFile(event.dataTransfer.files[0]);
      });
      fileInput.addEventListener("change", (event) => {
        if (event.target.files[0]) processFile(event.target.files[0]);
      });
      rerunButton.addEventListener("click", runScan);
      resetButton.addEventListener("click", () => {
        resultsCard.hidden = true;
        dropCard.hidden = false;
        loadedZip = null;
        loadedFilename = "";
        fileInput.value = "";
      });

      renderTags();
    },
  });
})();
