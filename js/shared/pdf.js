// PDF text extraction for the Document Tools convert workflow, built on pdfjs-dist (Mozilla
// PDF.js), lazily imported from CDN. Text-layer only: extraction stays a
// per-page function so a future OCR fallback (rasterize page → ns.ocrImage)
// can slot in for scanned pages without restructuring.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  const PDFJS_VERSION = "4.6.82";
  let _pdfjsPromise;
  function loadPdfjs() {
    if (!_pdfjsPromise) {
      _pdfjsPromise = import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`)
        .then((pdfjs) => {
          pdfjs.GlobalWorkerOptions.workerSrc =
            `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
          return pdfjs;
        });
    }
    return _pdfjsPromise;
  }

  // Insert a space between adjacent items when the horizontal gap warrants it.
  function joinItems(items) {
    let text = "", prevEnd = null;
    for (const it of items) {
      if (prevEnd !== null && it.x - prevEnd > Math.max(1, it.fontSize * 0.15) &&
          !text.endsWith(" ") && !it.str.startsWith(" ")) {
        text += " ";
      }
      text += it.str;
      prevEnd = it.x + it.width;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  // One page → positioned lines. Reading order is best-effort: items sorted by
  // vertical then horizontal position (content-stream order is unreliable),
  // with a new line whenever the y position moves by more than ~half a line.
  async function extractPage(page) {
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        // Vertical scale of the transform matrix ≈ rendered font size.
        fontSize: Math.hypot(it.transform[2], it.transform[3]) || Math.abs(it.transform[3]) || 10,
        width: it.width || 0,
      }));

    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));

    const lines = [];
    for (const item of items) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(item.y - line.y) <= Math.max(2, line.fontSize * 0.45)) {
        line.items.push(item);
      } else {
        lines.push({ y: item.y, fontSize: item.fontSize, items: [item] });
      }
    }
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      line.fontSize = Math.max(...line.items.map((i) => i.fontSize));
      line.text = joinItems(line.items);
      line.x0 = line.items[0].x;
      const last = line.items[line.items.length - 1];
      line.xEnd = last.x + last.width;
    }
    const viewport = page.getViewport({ scale: 1 });
    return { lines: lines.filter((l) => l.text), width: viewport.width, height: viewport.height };
  }

  // Hyperlinks embedded in the PDF as Link annotations (the actual clickable
  // links — separate from the text layer, since a link's visible label
  // doesn't need to be the URL itself). Correlating each annotation's
  // rectangle back to overlapping text for a real visible-text label is not
  // done here, so visibleText is a placeholder rather than a guess.
  ns.extractPdfLinks = async function extractPdfLinks(buffer) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const seen = new Set();
    const links = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const annotations = await page.getAnnotations();
      for (const ann of annotations) {
        if (ann.subtype !== "Link" || !ann.url) continue;
        const clean = ns.cleanUrl(ann.url);
        if (!clean || seen.has(clean)) continue;
        seen.add(clean);
        links.push({ visibleText: "[Feature unavailable for PDFs]", url: clean });
      }
    }
    return links;
  };

  // Whole document. rawText is the intentionally naive "before" baseline:
  // per-page lines joined with newlines, pages separated by a blank line, with
  // repeated headers/footers, page numbers, and broken line wraps left in.
  ns.extractPdf = async function extractPdf(buffer) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      pages.push(await extractPage(await doc.getPage(n)));
    }
    const rawText = pages.map((p) => p.lines.map((l) => l.text).join("\n")).join("\n\n");
    return { pages, rawText, pageCount: doc.numPages };
  };

  // ---- Markdown conversion heuristics ----

  const PAGE_NUM_RE = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;
  const normKey = (text) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

  // Lines appearing near-identically at the top/bottom of most pages are
  // running headers/footers — stripped from the Markdown output only.
  function repeatedEdgeKeys(pages) {
    if (pages.length < 3) return new Set();
    const counts = new Map();
    for (const page of pages) {
      const edges = [...page.lines.slice(0, 2), ...page.lines.slice(-2)];
      for (const key of new Set(edges.map((l) => normKey(l.text)).filter((k) => k && k.length <= 120))) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const min = Math.ceil(pages.length * 0.6);
    return new Set([...counts].filter(([, c]) => c >= min).map(([k]) => k));
  }

  function weightedMedianFontSize(pages) {
    const entries = [];
    let total = 0;
    for (const page of pages) for (const line of page.lines) {
      if (line.text.length >= 4) { entries.push([line.fontSize, line.text.length]); total += line.text.length; }
    }
    if (!entries.length) return 0;
    entries.sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [size, weight] of entries) {
      acc += weight;
      if (acc >= total / 2) return size;
    }
    return entries[entries.length - 1][0];
  }

  const LIST_RE = /^([•●○◦▪‣∙·–—-]|\d{1,3}[.)]|[a-z][.)])\s+(.+)$/;

  function listItem(text) {
    const m = text.match(LIST_RE);
    if (!m) return null;
    const marker = m[1];
    if (/^\d/.test(marker)) return `${parseInt(marker, 10)}. ${m[2]}`;
    if (/^[a-z]/.test(marker)) return `- ${m[2]}`;
    return `- ${m[2]}`;
  }

  // Headings that read as headings from their text alone, independent of
  // font size — needed for documents (common in contracts) that style
  // section titles with bold/caps/numbering rather than a larger point size.
  const NUMBERED_HEADING_RE = /^[0-9]+(?:\.[0-9]+)*[A-Za-z]?\.?\s+[A-Z].{0,80}$/;
  const ALLCAPS_HEADING_RE = /^[A-Z][A-Z\s&"'-]{4,60}$/;
  const BARE_NUMBERING_RE = /^[0-9]{1,3}[A-Za-z]?\.?$/;
  const MINOR_WORDS = new Set(["of", "and", "the", "for", "to", "in", "a", "an", "or", "&"]);

  // Short Title Case line that isn't numbered/ALL-CAPS (e.g. "Exhibit A —
  // Statement of Work"): most words are capitalized, any lowercase ones are
  // minor connectors, and it doesn't end like a sentence.
  function looksLikeTitleCaseHeading(text) {
    if (text.length >= 70 || /[.!?,]$/.test(text)) return false;
    const words = text.split(/\s+/);
    if (words.length < 2 || words.length > 9) return false;
    let capCount = 0;
    for (const w of words) {
      const bare = w.replace(/[^A-Za-z]/g, "");
      if (!bare) continue;
      if (/^[A-Z]/.test(bare)) capCount++;
      else if (!MINOR_WORDS.has(w.toLowerCase())) return false;
    }
    return capCount >= Math.ceil(words.length * 0.5);
  }

  function isPatternHeading(text) {
    return ALLCAPS_HEADING_RE.test(text) || looksLikeTitleCaseHeading(text);
  }

  // Split a line's items into table cells on large horizontal gaps.
  function cellsOf(line) {
    const cells = [];
    let cur = null;
    for (const it of line.items) {
      if (cur && it.x - cur.end > Math.max(14, line.fontSize * 1.6)) { cells.push(cur); cur = null; }
      if (!cur) cur = { text: it.str.trim(), start: it.x, end: it.x + it.width };
      else {
        cur.text += (it.str.startsWith(" ") || cur.text.endsWith(" ") ? "" : " ") + it.str.trim();
        cur.end = it.x + it.width;
      }
    }
    if (cur) cells.push(cur);
    return cells;
  }

  // Detect a run of consecutive lines that look tabular: same cell count (2-10)
  // with roughly aligned column start positions. Conservative — anything less
  // confident falls through to plain lines instead of malformed table syntax.
  function tableRun(lines, start) {
    const first = cellsOf(lines[start]);
    if (first.length < 2 || first.length > 10) return null;
    const rows = [first];
    let end = start + 1;
    while (end < lines.length) {
      const cells = cellsOf(lines[end]);
      if (cells.length !== first.length) break;
      const aligned = cells.every((c, i) => Math.abs(c.start - first[i].start) <= 30);
      if (!aligned) break;
      rows.push(cells);
      end++;
    }
    if (rows.length < 2) return null;
    return { rows: rows.map((r) => r.map((c) => c.text)), end };
  }

  function headingLevel(line, bodySize, sizesUniform, nextLine, continuingList) {
    const text = line.text;
    if (text.length > 120) return 0;

    // A bullet/lettered marker line is always a list item. A numbered marker
    // ("1. Indemnification") is ambiguous with an ordered-list item of the
    // same shape, so it only counts as a heading when it's isolated: not
    // continuing a list already in progress, and not immediately followed by
    // another marker line (which would mean it's the start of a real list).
    const isNumberedMarker = LIST_RE.test(text) && NUMBERED_HEADING_RE.test(text);
    if (LIST_RE.test(text) && !isNumberedMarker) return 0;
    const numberedQualifies = isNumberedMarker &&
      !continuingList && !(nextLine && listItem(nextLine.text));
    if (isNumberedMarker && !numberedQualifies) return 0;

    const patternMatch = isPatternHeading(text) || numberedQualifies;
    if (!sizesUniform && bodySize) {
      const ratio = line.fontSize / bodySize;
      if (ratio >= 1.7) return 1;
      if (ratio >= 1.35) return 2;
      if (ratio >= 1.15 && !/[.,;:]$/.test(text)) return 3;
      if (ratio >= 0.95 && patternMatch) return 3;
      return 0;
    }
    if (patternMatch) return 3;
    // Fallback when font info is unreliable: a short standalone line followed
    // by paragraph-length text.
    if (text.length <= 60 && !/[.!?,;:]$/.test(text) && nextLine && nextLine.text.length > 60) return 2;
    return 0;
  }

  ns.pdfMarkdown = function pdfMarkdown(pages) {
    const stripKeys = repeatedEdgeKeys(pages);
    const bodySize = weightedMedianFontSize(pages);
    const sizes = [];
    for (const page of pages) for (const line of page.lines) if (line.text.length >= 4) sizes.push(line.fontSize);
    const sizesUniform = sizes.length ? Math.max(...sizes) / Math.min(...sizes) <= 1.05 : true;

    const blocks = [];
    let para = null;
    // List nesting base persists across page boundaries while a list block
    // continues; it re-anchors whenever a list starts fresh.
    let listBase = null, listDepth = 0;
    const flushPara = () => { if (para) { blocks.push(para.text); para = null; } };
    const lastBlockIsList = () => {
      const last = blocks[blocks.length - 1];
      return typeof last === "string" && /^ *(-|\d+\.) /.test(last.split("\n").pop() || "");
    };

    for (const page of pages) {
      const lines = page.lines.filter((line, idx) => {
        const nearEdge = idx < 2 || idx >= page.lines.length - 2;
        if (!nearEdge) return true;
        if (PAGE_NUM_RE.test(line.text.trim())) return false;
        return !stripKeys.has(normKey(line.text));
      });
      if (!lines.length) { flushPara(); continue; }

      // Page geometry. pageLeft approximates the left margin; a line can only
      // be a wrapped continuation of the previous one if it reached near the
      // right margin (fullX). Indent depth relative to pageLeft maps to list
      // nesting at Word's default 36pt (0.5") indent step.
      const pageLeft = Math.min(...lines.map((l) => l.x0));
      const rightEdge = (page.width || 612) - pageLeft;
      const fullX = rightEdge - Math.max(24, (rightEdge - pageLeft) * 0.12);
      const isIndented = (l) => l.x0 >= pageLeft + 18;
      const levelOf = (l) => Math.max(1, Math.min(5, Math.round((l.x0 - pageLeft) / 36)));
      let lastItem = null;
      // Emits a list item; consecutive items form one block. Nesting is
      // normalized relative to the block's first item so a list that happens to
      // sit deep on the page still starts at indent 0 (deep absolute indents
      // would render as code blocks in Markdown).
      const emitItem = (line, text) => {
        flushPara();
        const cont = lastBlockIsList();
        if (!cont || listBase === null) listBase = levelOf(line);
        // An item can nest at most one level deeper than the previous item.
        const depth = cont
          ? Math.max(0, Math.min(4, levelOf(line) - listBase, listDepth + 1))
          : 0;
        listDepth = depth;
        const item = `${"  ".repeat(depth)}${text}`;
        if (cont) blocks[blocks.length - 1] += `\n${item}`;
        else blocks.push(item);
        lastItem = { x0: line.x0, xEnd: line.xEnd, fontSize: line.fontSize };
      };

      let i = 0;
      while (i < lines.length) {
        const run = tableRun(lines, i);
        if (run) {
          flushPara(); lastItem = null;
          blocks.push(ns.markdownTable(run.rows));
          i = run.end;
          continue;
        }
        const line = lines[i];
        // Orphan bullet glyphs (a marker whose text ended up on another line).
        if (/^[•●○◦▪‣∙·]+$/.test(line.text.trim())) { i++; continue; }

        // A standalone section number ("7A.") followed by its title on the
        // next line (the number rendered as a separate text run): test the
        // combined text as one heading candidate.
        if (i + 1 < lines.length && !lastBlockIsList() && BARE_NUMBERING_RE.test(line.text.trim())) {
          const next = lines[i + 1];
          const sep = line.text.trim().endsWith(".") ? " " : ". ";
          const combined = { text: `${line.text.trim()}${sep}${next.text}`, fontSize: Math.max(line.fontSize, next.fontSize) };
          const combinedLevel = headingLevel(combined, bodySize, sizesUniform, lines[i + 2], false);
          if (combinedLevel) {
            flushPara(); lastItem = null;
            blocks.push(`${"#".repeat(combinedLevel)} ${combined.text}`);
            i += 2;
            continue;
          }
        }

        // Heading detection runs before list-item detection so an isolated
        // numbered section title ("1. Indemnification") isn't swallowed into
        // an ordered list; headingLevel still defers ordinary numbered list
        // items back to the list-item path below.
        const level = headingLevel(line, bodySize, sizesUniform, lines[i + 1], lastBlockIsList());
        if (level) {
          flushPara(); lastItem = null;
          blocks.push(`${"#".repeat(level)} ${line.text}`);
          i++;
          continue;
        }

        const item = listItem(line.text);
        if (item) {
          emitItem(line, item);
          i++;
          continue;
        }
        // Wrapped continuation of the previous list item: the item's last line
        // reached the right margin, and this line starts at or past the item's
        // indent in the same font size.
        if (lastItem && lastItem.xEnd >= fullX && line.x0 >= lastItem.x0 - 2 &&
            Math.abs(line.fontSize - lastItem.fontSize) <= lastItem.fontSize * 0.25) {
          const last = blocks[blocks.length - 1];
          blocks[blocks.length - 1] = last.endsWith("-")
            ? last.slice(0, -1) + line.text
            : `${last} ${line.text}`;
          lastItem.xEnd = line.xEnd;
          i++;
          continue;
        }
        // A run of indented standalone lines is a list whose bullet glyphs did
        // not survive into the text layer (common for Word symbol-font bullets).
        // Multi-cell lines (wide gaps = table columns) are excluded, but a
        // small internal gap (e.g. around an inline link) is tolerated.
        const cells = cellsOf(line);
        const compact = cells.length === 1 || (cells.length === 2 && cells[1].start - cells[0].end < 48);
        if (isIndented(line) && compact &&
            ((i > 0 && isIndented(lines[i - 1])) || (i + 1 < lines.length && isIndented(lines[i + 1])))) {
          emitItem(line, `- ${line.text}`);
          i++;
          continue;
        }
        lastItem = null;
        // Paragraph text: rejoin wrapped lines. The previous line must have
        // reached the right margin, and the join must not cross a sentence
        // boundary into a capitalized line.
        if (para) {
          const gap = para.lastY - line.y;
          const sameParagraph = gap >= 0 && gap <= line.fontSize * 1.8 && para.lastXEnd >= fullX &&
            (!/[.!?:]["')\]]?$/.test(para.text) || /^[a-z]/.test(line.text));
          if (sameParagraph) {
            para.text = para.text.endsWith("-")
              ? para.text.slice(0, -1) + line.text
              : `${para.text} ${line.text}`;
            para.lastY = line.y;
            para.lastXEnd = line.xEnd;
            i++;
            continue;
          }
          flushPara();
        }
        para = { text: line.text, lastY: line.y, lastXEnd: line.xEnd };
        i++;
      }
      flushPara();
      para = null; // never join paragraphs across page boundaries' y-reset
    }
    flushPara();
    return `${blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  };
})();
