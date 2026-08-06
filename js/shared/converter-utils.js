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

  // -- File-type detection --

  // Sniffs a File's extension and returns one of the Document Tools workflow
  // format ids ("docx" | "pptx" | "pdf" | "html" | "image"), or null if
  // unrecognized. Shared between the document rail (file intake) and any
  // workflow that needs to know what it was just handed.
  ns.detectDocumentFileType = function detectDocumentFileType(file) {
    const lower = (file?.name || "").toLowerCase();
    if (lower.endsWith(".docx")) return "docx";
    if (lower.endsWith(".pptx")) return "pptx";
    if (lower.endsWith(".pdf")) return "pdf";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (/\.(png|jpe?g|webp)$/.test(lower)) return "image";
    return null;
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

  // Strips Markdown syntax to approximate the plain-text content of a Markdown
  // string. Used for the "plain text vs. formatting overhead" output split when
  // there is no HTML intermediate (PPTX, PDF, and OCR pipelines).
  ns.plainTextOfMarkdown = function plainTextOfMarkdown(md) {
    const text = String(md || "")
      .replace(/^```.*$/gm, "")                 // code fence markers
      .replace(/^\|? *:?-{3,}[-|: ]*$/gm, "")   // table separator rows + hrules
      .replace(/^[ \t]*>+ ?/gm, "")             // blockquote markers
      .replace(/^[ \t]*#{1,6} +/gm, "")         // heading markers
      .replace(/^[ \t]*[-*+] +/gm, "")          // bullet markers
      .replace(/^[ \t]*\d+\. +/gm, "")          // numbered-list markers
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")  // links
      .replace(/(\*\*|__|~~|`)/g, "")           // emphasis and code spans
      .replace(/ *\| */g, " ")                  // table pipes
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return `${text}\n`;
  };

  // Renders rows (array of string arrays, first row = header) as a Markdown
  // table, padding ragged rows to a uniform width.
  ns.markdownTable = function markdownTable(rows) {
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length));
    const norm = rows.map((row) => {
      const cells = row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim());
      while (cells.length < width) cells.push("");
      return cells;
    });
    const line = (row) => `| ${row.join(" | ")} |`;
    return `${line(norm[0])}\n${line(Array(width).fill("---"))}\n${norm.slice(1).map(line).join("\n")}`;
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
