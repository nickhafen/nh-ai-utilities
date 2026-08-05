// PPTX parsing for the Token Saver tool. Same architectural pattern as the
// DOCX pipeline: the .pptx is an OOXML zip whose XML parts are read with JSZip,
// token-counted raw for the "before" baseline, and parsed for Markdown output.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  const RELNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const FOOTER_PH = new Set(["sldNum", "ftr", "dt"]);
  const TITLE_PH = new Set(["title", "ctrTitle"]);

  const byLocal = (root, name) => Array.from(root.getElementsByTagNameNS("*", name));

  function parseXml(str) {
    const doc = new DOMParser().parseFromString(str, "application/xml");
    return doc.querySelector("parsererror") ? null : doc;
  }

  // Text of one <a:p> paragraph: concatenated <a:t> runs, <a:br> as spaces.
  function paraText(p) {
    let out = "";
    (function walk(node) {
      for (const child of node.children) {
        if (child.localName === "t") out += child.textContent;
        else if (child.localName === "br") out += " ";
        else if (child.localName !== "pPr") walk(child);
      }
    })(p);
    return out.replace(/\s+/g, " ").trim();
  }

  function shapeInfo(sp) {
    const ph = byLocal(sp, "ph")[0];
    const type = ph ? (ph.getAttribute("type") || "body") : null; // null = plain text box
    const txBody = byLocal(sp, "txBody")[0];
    const paras = txBody
      ? byLocal(txBody, "p").map((p) => {
          const pPr = byLocal(p, "pPr")[0];
          return { text: paraText(p), lvl: Number((pPr && pPr.getAttribute("lvl")) || 0) };
        }).filter((p) => p.text)
      : [];
    return { type, paras };
  }

  function extractSlide(doc) {
    const hidden = doc.documentElement.getAttribute("show") === "0";
    let title = "", subtitle = "";
    const blocks = [];
    const footers = [];
    const spTree = byLocal(doc, "spTree")[0];

    (function walk(parent) {
      if (!parent) return;
      for (const node of parent.children) {
        if (node.localName === "sp") {
          const { type, paras } = shapeInfo(node);
          if (!paras.length) continue;
          const joined = paras.map((p) => p.text).join(" ");
          if (type && TITLE_PH.has(type)) title = title || joined;
          else if (type === "subTitle") subtitle = subtitle || joined;
          else if (type && FOOTER_PH.has(type)) footers.push(joined);
          else if (type) blocks.push({ type: "bullets", items: paras });
          else blocks.push({ type: "paras", items: paras });
        } else if (node.localName === "graphicFrame") {
          const tbl = byLocal(node, "tbl")[0];
          if (tbl) {
            const rows = byLocal(tbl, "tr").map((tr) =>
              byLocal(tr, "tc").map((tc) => {
                const txBody = byLocal(tc, "txBody")[0];
                return txBody ? byLocal(txBody, "p").map(paraText).filter(Boolean).join(" ") : "";
              })
            ).filter((row) => row.some(Boolean));
            if (rows.length) blocks.push({ type: "table", rows });
            continue;
          }
          const chartRef = byLocal(node, "chart")[0];
          if (chartRef) {
            const rId = chartRef.getAttributeNS(RELNS, "id") || chartRef.getAttribute("r:id");
            if (rId) blocks.push({ type: "chart", rId });
          }
        } else if (node.localName === "grpSp") {
          walk(node);
        }
      }
    })(spTree);

    return { hidden, title, subtitle, blocks, footers };
  }

  // Slide XML with slide-number/footer/date placeholder shapes removed, for the
  // baseline token count when those are toggled off. Null when nothing removed.
  function xmlWithoutFooterShapes(doc) {
    const clone = doc.cloneNode(true);
    let removed = false;
    for (const sp of byLocal(clone, "sp")) {
      const ph = byLocal(sp, "ph")[0];
      if (ph && FOOTER_PH.has(ph.getAttribute("type"))) { sp.remove(); removed = true; }
    }
    return removed ? new XMLSerializer().serializeToString(clone) : null;
  }

  function notesText(doc) {
    for (const sp of byLocal(doc, "sp")) {
      const ph = byLocal(sp, "ph")[0];
      if (ph && ph.getAttribute("type") === "body") {
        const txBody = byLocal(sp, "txBody")[0];
        if (txBody) return byLocal(txBody, "p").map(paraText).filter(Boolean).join("\n");
      }
    }
    return "";
  }

  // Chart XML: title, plus per-series name/category/value caches when present.
  function chartSummary(doc) {
    if (!doc) return null;
    const titleEl = byLocal(doc, "title")[0];
    const title = titleEl ? byLocal(titleEl, "t").map((t) => t.textContent).join("").trim() : "";
    const series = byLocal(doc, "ser").map((ser) => {
      const tx = byLocal(ser, "tx")[0];
      const name = tx ? byLocal(tx, "v").map((v) => v.textContent).join(" ").trim() : "";
      const catEl = byLocal(ser, "cat")[0];
      const cats = catEl ? byLocal(catEl, "pt").map((pt) => (byLocal(pt, "v")[0] || {}).textContent || "") : [];
      const valEl = byLocal(ser, "val")[0];
      const vals = valEl ? byLocal(valEl, "pt").map((pt) => (byLocal(pt, "v")[0] || {}).textContent || "") : [];
      return { name, cats, vals };
    });
    return { title, series };
  }

  async function readRels(zip, partPath) {
    const relsPath = partPath.replace(/([^/]+)$/, "_rels/$1.rels");
    const entry = zip.files[relsPath];
    if (!entry) return {};
    const doc = parseXml(await entry.async("string"));
    const map = {};
    if (doc) for (const rel of byLocal(doc, "Relationship")) {
      map[rel.getAttribute("Id")] = { type: rel.getAttribute("Type") || "", target: rel.getAttribute("Target") || "" };
    }
    return map;
  }

  function resolveTarget(basePath, target) {
    const parts = basePath.split("/").slice(0, -1);
    for (const seg of target.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg && seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  }

  // Slide order per presentation.xml's sldIdLst; falls back to numeric names.
  async function orderedSlidePaths(zip) {
    const fallback = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)[1]) - Number(b.match(/(\d+)\.xml$/i)[1]));
    try {
      const presEntry = zip.files["ppt/presentation.xml"];
      if (!presEntry) return fallback;
      const [rels, doc] = await Promise.all([
        readRels(zip, "ppt/presentation.xml"),
        presEntry.async("string").then(parseXml),
      ]);
      if (!doc) return fallback;
      const ordered = byLocal(doc, "sldId")
        .map((el) => rels[el.getAttributeNS(RELNS, "id") || el.getAttribute("r:id")])
        .filter((rel) => rel && /\/slide\b|slides\//i.test(rel.target))
        .map((rel) => resolveTarget("ppt/presentation.xml", rel.target))
        .filter((path) => zip.files[path]);
      return ordered.length ? ordered : fallback;
    } catch { return fallback; }
  }

  ns.parsePptx = async function parsePptx(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const slidePaths = await orderedSlidePaths(zip);

    const slides = [];
    for (const [i, path] of slidePaths.entries()) {
      const xml = await zip.files[path].async("string");
      const doc = parseXml(xml);
      const info = doc ? extractSlide(doc) : { hidden: false, title: "", subtitle: "", blocks: [], footers: [] };
      const rels = await readRels(zip, path);

      let notesXml = "", notes = "";
      for (const rel of Object.values(rels)) {
        if (/notesSlide/i.test(rel.type)) {
          const notesPath = resolveTarget(path, rel.target);
          if (zip.files[notesPath]) {
            notesXml = await zip.files[notesPath].async("string");
            const notesDoc = parseXml(notesXml);
            notes = notesDoc ? notesText(notesDoc) : "";
          }
        }
      }

      for (const block of info.blocks) {
        if (block.type === "chart" && rels[block.rId]) {
          const chartPath = resolveTarget(path, rels[block.rId].target);
          if (zip.files[chartPath]) {
            block.chartXml = await zip.files[chartPath].async("string");
            block.chart = chartSummary(parseXml(block.chartXml));
          }
        }
      }

      slides.push({
        n: i + 1, path, xml,
        xmlSansFooters: doc ? xmlWithoutFooterShapes(doc) : null,
        notesXml, notes, ...info,
      });
    }

    const collect = (re) => Promise.all(
      Object.keys(zip.files).filter((n) => re.test(n)).sort().map((n) => zip.files[n].async("string"))
    );
    const [layouts, masters, themes] = await Promise.all([
      collect(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/i),
      collect(/^ppt\/slideMasters\/slideMaster\d+\.xml$/i),
      collect(/^ppt\/theme\/theme\d+\.xml$/i),
    ]);
    const presentationXml = zip.files["ppt/presentation.xml"]
      ? await zip.files["ppt/presentation.xml"].async("string") : "";

    return { slides, layouts, masters, themes, presentationXml };
  };

  // Deduplicated visible text from slide layouts and masters (mostly template
  // placeholder prompts and recurring footer text).
  ns.pptxLayoutMasterText = function pptxLayoutMasterText(parsed) {
    const texts = new Set();
    for (const xml of [...parsed.layouts, ...parsed.masters]) {
      const doc = parseXml(xml);
      if (!doc) continue;
      for (const t of byLocal(doc, "t")) {
        const s = t.textContent.replace(/\s+/g, " ").trim();
        if (s) texts.add(s);
      }
    }
    return Array.from(texts);
  };

  function chartMarkdown(chart) {
    const header = `**Chart: ${chart.title || "Untitled"}**`;
    const withData = chart.series.filter((s) => s.cats.length && s.vals.length);
    if (withData.length) {
      const cats = withData[0].cats.slice(0, 50);
      const rows = [
        ["Category", ...withData.map((s, i) => s.name || `Series ${i + 1}`)],
        ...cats.map((cat, i) => [cat, ...withData.map((s) => s.vals[i] ?? "")]),
      ];
      return `${header}\n\n${ns.markdownTable(rows)}`;
    }
    const names = chart.series.map((s) => s.name).filter(Boolean);
    return names.length ? `${header} — series: ${names.join(", ")}` : header;
  }

  ns.pptxMarkdown = function pptxMarkdown(parsed, options) {
    const out = [];
    for (const slide of parsed.slides) {
      if (slide.hidden && !options.hiddenSlides) continue;
      const parts = [slide.title ? `## Slide ${slide.n}: ${slide.title}` : `## Slide ${slide.n}`];
      if (slide.subtitle) parts.push(slide.subtitle);
      for (const block of slide.blocks) {
        if (block.type === "bullets") {
          parts.push(block.items.map((it) => `${"  ".repeat(Math.min(it.lvl, 5))}- ${it.text}`).join("\n"));
        } else if (block.type === "paras") {
          parts.push(block.items.map((it) => it.text).join("\n\n"));
        } else if (block.type === "table") {
          parts.push(ns.markdownTable(block.rows));
        } else if (block.type === "chart" && options.embeddedData && block.chart) {
          parts.push(chartMarkdown(block.chart));
        }
      }
      if (options.slideFooters && slide.footers.length) {
        parts.push(slide.footers.map((f) => `*${f}*`).join(" · "));
      }
      if (options.speakerNotes && slide.notes) {
        parts.push(`> **Notes:** ${slide.notes.replace(/\n/g, "\n> ")}`);
      }
      out.push(parts.join("\n\n"));
    }
    if (options.masterPlaceholders) {
      const texts = ns.pptxLayoutMasterText(parsed);
      if (texts.length) out.push(`## Master and layout text\n\n${texts.map((t) => `- ${t}`).join("\n")}`);
    }
    return `${out.join("\n\n")}\n`;
  };
})();
