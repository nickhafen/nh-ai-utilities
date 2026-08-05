// Shared utilities for all converter tools (DOCX, Web Page, PDF, …).
// Loaded before any tool script that depends on these.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  // -- Tokenizer --

  let _tokenizerPromise;

  ns.countTokens = async function countTokens(text) {
    if (!_tokenizerPromise) {
      _tokenizerPromise = import("https://esm.sh/js-tiktoken@1.0.21")
        .then(({ getEncoding }) => getEncoding("o200k_base"));
    }
    const tokenizer = await _tokenizerPromise;
    return tokenizer.encode(String(text || "")).length;
  };

  // -- Plain-text extraction --

  // Returns plain text from an HTML string for token-count comparison.
  // Used to separate "real content" from "formatting overhead" in Bar 2 of the breakdown.
  ns.plainTextOfHtml = function plainTextOfHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body.cloneNode(true);
    body.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
    body.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,tr,blockquote,section").forEach((el) => el.append("\n"));
    return `${body.textContent.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  };

  // -- Segmented bar --

  // Renders a phone-storage-style horizontal segmented bar into `container`.
  // segments: [{ label, tokens, color }]  total: sum used for percentages
  // Segment widths are proportional via flex-grow so they always fill the bar exactly.
  ns.renderSegBar = function renderSegBar(container, segments, total) {
    const fmt = (n) => new Intl.NumberFormat().format(n);
    const track = Object.assign(document.createElement("div"), { className: "seg-bar-track" });
    const legend = Object.assign(document.createElement("div"), { className: "seg-bar-legend" });
    segments.forEach(({ label, tokens, color }) => {
      const pct = total ? Math.round(tokens / total * 100) : 0;
      const seg = Object.assign(document.createElement("div"), { className: "seg-bar-seg" });
      seg.style.cssText = `flex:${tokens} 0 0;background:${color}`;
      seg.title = `${label}: ${fmt(tokens)} tokens (${pct}%)`;
      track.appendChild(seg);
      const item = Object.assign(document.createElement("span"), { className: "seg-bar-legend-item" });
      item.innerHTML = `<span class="seg-bar-swatch" style="background:${color}"></span>${label}: ${fmt(tokens)} (${pct}%)`;
      legend.appendChild(item);
    });
    container.innerHTML = "";
    container.appendChild(track);
    container.appendChild(legend);
  };
})();
