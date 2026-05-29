(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml, copyText } = ns;

  const CONCURRENCY = 6;
  const TIMEOUT_MS = 8000;

  async function checkUrl(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      await fetch(url, {
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });
      return "reachable";
    } catch (err) {
      return err.name === "AbortError" ? "timeout" : "unreachable";
    } finally {
      clearTimeout(timer);
    }
  }

  async function runWithConcurrency(items, fn, onResult) {
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const i = index++;
        const result = await fn(items[i]);
        onResult(i, result);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker)
    );
  }

  function parseUrls(text) {
    return text
      .split(/[\n,]+/)
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\//i.test(line));
  }

  function statusCell(status) {
    if (status === "pending")   return `<span class="link-badge badge-pending">Checking…</span>`;
    if (status === "reachable") return `<span class="link-badge badge-reachable">Reachable</span>`;
    if (status === "timeout")   return `<span class="link-badge badge-timeout">Timed out</span>`;
    return `<span class="link-badge badge-unreachable">Unreachable</span>`;
  }

  ns.registerTool({
    id: "dead-link-checker",
    name: "Dead Links",
    description: "Check a list of URLs and flag unreachable ones.",
    render(root) {
      let running = false;
      let resultData = [];

      root.innerHTML = `
        <div class="tool-view">
          <div class="utility-grid">
            <section class="panel">
              <div class="panel-header">
                <span class="panel-title">URLs to check</span>
              </div>
              <div class="panel-body">
                <p class="tool-hint">Need to pull URLs from a document first? Use the <a class="tool-link" href="#url-extractor">URL Extractor</a>.</p>
                <textarea
                  class="textarea"
                  data-url-input
                  placeholder="Paste URLs here, one per line…"
                  spellcheck="false"
                ></textarea>
              </div>
              <div class="panel-footer">
                <button class="btn btn-primary" data-check>Check Links</button>
                <button class="btn btn-subtle" data-clear>Clear</button>
              </div>
            </section>

            <section class="panel">
              <div class="panel-header">
                <span class="panel-title">Results</span>
                <div class="panel-actions">
                  <span class="count-pill" data-pill-reachable hidden></span>
                  <span class="count-pill count-pill-warn" data-pill-bad hidden></span>
                  <button class="btn btn-subtle" data-copy-bad hidden>Copy flagged</button>
                </div>
              </div>
              <div class="panel-body" data-results>
                <p class="hint">Results will appear here as each link is checked.</p>
              </div>
            </section>
          </div>

          <p class="disclaimer">
            <strong>Note:</strong> This tool can only detect whether a server responded — not what it said back.
            A URL returning a "404 Not Found" error will still show as <em>Reachable</em> because a server did respond.
            <em>Unreachable</em> doesn't always mean a link is hallucinated — some legitimate links get wrapped or redirected by services like LinkedIn or Google, which can cause them to fail here.
            Always double-check flagged links before drawing conclusions.
          </p>
        </div>
      `;

      const urlInput      = $("[data-url-input]", root);
      const checkButton   = $("[data-check]", root);
      const clearButton   = $("[data-clear]", root);
      const resultsArea   = $("[data-results]", root);
      const pillReachable = $("[data-pill-reachable]", root);
      const pillBad       = $("[data-pill-bad]", root);
      const copyBadButton = $("[data-copy-bad]", root);

      function updatePills() {
        const reachable = resultData.filter((r) => r.status === "reachable").length;
        const bad       = resultData.filter((r) => r.status === "unreachable" || r.status === "timeout").length;
        const pending   = resultData.filter((r) => r.status === "pending").length;

        pillReachable.hidden = reachable === 0 && pending > 0;
        pillReachable.textContent = `${reachable} reachable`;

        pillBad.hidden = bad === 0;
        pillBad.textContent = `${bad} flagged`;

        copyBadButton.hidden = bad === 0;
      }

      function updateRow(i) {
        const row = root.querySelector(`tr[data-row="${i}"]`);
        if (row) {
          row.querySelector(".status-cell").innerHTML = statusCell(resultData[i].status);
          if (resultData[i].status !== "pending") {
            row.dataset.status = resultData[i].status;
          }
        }
      }

      async function runCheck() {
        const urls = parseUrls(urlInput.value);
        if (!urls.length) {
          resultsArea.innerHTML = `<p class="hint">No valid URLs found. Make sure each URL starts with http:// or https://.</p>`;
          return;
        }

        running = true;
        checkButton.disabled = true;
        checkButton.textContent = "Checking…";
        pillReachable.hidden = true;
        pillBad.hidden = true;
        copyBadButton.hidden = true;

        resultData = urls.map((url) => ({ url, status: "pending" }));

        resultsArea.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th class="col-status">Status</th>
                </tr>
              </thead>
              <tbody>
                ${resultData.map((r, i) => `
                  <tr data-row="${i}" data-status="pending">
                    <td class="col-url">${escapeHtml(r.url)}</td>
                    <td class="status-cell col-status">${statusCell("pending")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;

        await runWithConcurrency(urls, checkUrl, (i, status) => {
          resultData[i].status = status;
          updateRow(i);
          updatePills();
        });

        running = false;
        checkButton.disabled = false;
        checkButton.textContent = "Check Links";
      }

      checkButton.addEventListener("click", () => {
        if (!running) runCheck();
      });

      clearButton.addEventListener("click", () => {
        urlInput.value = "";
        resultsArea.innerHTML = `<p class="hint">Results will appear here as each link is checked.</p>`;
        pillReachable.hidden = true;
        pillBad.hidden = true;
        copyBadButton.hidden = true;
        resultData = [];
      });

      copyBadButton.addEventListener("click", async () => {
        const bad = resultData
          .filter((r) => r.status === "unreachable" || r.status === "timeout")
          .map((r) => r.url);
        if (bad.length) await copyText(bad.join("\n"));
      });
    },
  });
})();
