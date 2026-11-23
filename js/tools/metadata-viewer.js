// Metadata Viewer: drop a file and see every metadata field it carries, with
// full-length values (Word's Advanced Properties dialog truncates them).
// Office Open XML files (.docx/.xlsx/.pptx and their macro/template variants)
// are read with JSZip; PDFs through pdf.js (ns.extractPdfMetadata). Anything
// else shows the basic file information the browser exposes.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml, copyText } = ns;

  const ACCEPT = ".docx,.docm,.dotx,.dotm,.xlsx,.xlsm,.xltx,.xltm,.pptx,.pptm,.potx,.potm,.ppsx,.ppsm,.pdf,*/*";

  const CORE_LABELS = {
    title: "Title", subject: "Subject", creator: "Author", keywords: "Keywords",
    description: "Comments", lastModifiedBy: "Last modified by", revision: "Revision number",
    created: "Created", modified: "Modified", category: "Category", contentStatus: "Status",
    lastPrinted: "Last printed", language: "Language", identifier: "Identifier", version: "Version",
  };

  const VT_TYPES = {
    lpwstr: "Text", lpstr: "Text", bstr: "Text", filetime: "Date", date: "Date", bool: "Yes/No",
    i1: "Number", i2: "Number", i4: "Number", i8: "Number", int: "Number",
    ui1: "Number", ui2: "Number", ui4: "Number", ui8: "Number", uint: "Number",
    r4: "Number", r8: "Number", decimal: "Number", cy: "Currency", clsid: "ID", error: "Error code",
  };

  const XSI = "http://www.w3.org/2001/XMLSchema-instance";

  ns.registerTool({
    id: "metadata-viewer",
    name: "Metadata Viewer",
    description: "See every metadata field in a Word, Excel, PowerPoint, or PDF file, including custom properties",
    persist: true,
    render(root) {
      root.innerHTML = `
        <div class="tool-view metadata-viewer">
          <section class="panel">
            <div class="panel-header">
              <div>
                <span class="panel-title">Metadata Viewer</span>
                <p class="mv-subtitle">See every metadata field in a file, at full length &mdash; including the custom properties Word's Advanced Properties dialog cuts off.</p>
              </div>
            </div>
            <div class="panel-body">
              <div id="mv-drop" class="drop-area mv-drop" role="button" tabindex="0" aria-label="Choose a file">
                <span class="drop-icon">FILE</span>
                <strong class="primary-text">Drop a file here</strong>
                <span class="hint">.docx, .xlsx, .pptx, .pdf &mdash; or click to choose. Other files show basic file info.</span>
                <input id="mv-file" type="file" accept="${ACCEPT}" hidden>
              </div>
              <p id="mv-error" class="converter-error" role="alert" hidden></p>
              <p id="mv-status" class="hint mv-status" hidden></p>
            </div>
          </section>

          <section id="mv-results" class="panel" hidden>
            <div class="panel-header">
              <div class="mv-file-heading">
                <span class="panel-title">Fields</span>
                <strong id="mv-filename" class="mv-filename"></strong>
              </div>
              <div class="panel-actions">
                <input id="mv-filter" class="text-input mv-filter" type="search" placeholder="Filter fields or values" aria-label="Filter fields or values">
                <button id="mv-copy" class="btn btn-secondary" type="button">Copy JSON</button>
                <button id="mv-download" class="btn btn-secondary" type="button">Download JSON</button>
              </div>
            </div>
            <div class="panel-body">
              <div id="mv-sections" class="mv-sections"></div>
              <p id="mv-nomatch" class="empty-note" hidden>No fields match that filter.</p>
            </div>
          </section>
        </div>`;

      const drop = $("#mv-drop", root);
      const fileInput = $("#mv-file", root);
      const errorEl = $("#mv-error", root);
      const statusEl = $("#mv-status", root);
      const results = $("#mv-results", root);
      const sectionsEl = $("#mv-sections", root);
      const filterInput = $("#mv-filter", root);
      const noMatch = $("#mv-nomatch", root);
      let current = null; // { fileName, sections }
      let loadToken = 0;

      drop.addEventListener("click", () => fileInput.click());
      drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
      ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("drag-over"); }));
      ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("drag-over"); }));
      drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
      fileInput.addEventListener("change", () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ""; });

      filterInput.addEventListener("input", applyFilter);

      $("#mv-copy", root).addEventListener("click", async (e) => {
        if (!current) return;
        await copyText(JSON.stringify(toJson(current), null, 2));
        flash(e.currentTarget, "Copied");
      });
      $("#mv-download", root).addEventListener("click", () => {
        if (!current) return;
        const blob = new Blob([JSON.stringify(toJson(current), null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${current.fileName.replace(/\.[^.]+$/, "")}-metadata.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });

      sectionsEl.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-mv-copy]");
        if (!btn) return;
        const [s, r] = btn.dataset.mvCopy.split(":").map(Number);
        const row = current && current.sections[s] && current.sections[s].rows[r];
        if (!row) return;
        await copyText(row.value);
        flash(btn, "Copied");
      });

      async function loadFile(file) {
        const token = ++loadToken;
        errorEl.hidden = true;
        statusEl.hidden = false;
        statusEl.textContent = `Reading ${file.name}…`;
        try {
          const sections = [];
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
          const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
          const isPdf = String.fromCharCode(...bytes) === "%PDF-";
          let note = "";
          if (isZip) {
            const zip = await loadZip(buffer);
            if (zip.files["[Content_Types].xml"]) sections.push(...(await readOoxml(zip)));
            else note = "This is a zip archive but not an Office document, so only basic file info is shown.";
          } else if (isPdf || /\.pdf$/i.test(file.name)) {
            sections.push(...(await readPdf(buffer)));
          } else {
            note = "This file type has no document metadata this tool can read, so only basic file info is shown.";
          }
          const pkgIdx = sections.findIndex((x) => x.title === "Package contents");
          sections.splice(pkgIdx < 0 ? sections.length : pkgIdx, 0, fileSection(file));
          if (token !== loadToken) return;
          current = { fileName: file.name, sections: sections.filter((s) => s.rows.length || s.raw || s.keepEmpty) };
          statusEl.hidden = !note;
          statusEl.textContent = note;
          renderResults();
        } catch (err) {
          if (token !== loadToken) return;
          statusEl.hidden = true;
          errorEl.hidden = false;
          errorEl.textContent = `Couldn't read ${file.name}: ${err && err.message ? err.message : err}`;
        }
      }

      function renderResults() {
        $("#mv-filename", root).textContent = current.fileName;
        filterInput.value = "";
        sectionsEl.innerHTML = current.sections.map((section, s) => `
          <details class="mv-section" data-mv-section ${section.collapsed ? "" : "open"}>
            <summary>
              <span class="mv-section-title">${escapeHtml(section.title)}</span>
              <span class="mv-count">${section.rows.length} ${section.rows.length === 1 ? "field" : "fields"}</span>
              ${section.source ? `<code class="mv-source">${escapeHtml(section.source)}</code>` : ""}
            </summary>
            ${section.description ? `<p class="hint mv-section-desc">${escapeHtml(section.description)}</p>` : ""}
            ${section.rows.length ? `
            <table class="mv-table">
              <thead><tr><th scope="col">Field</th>${section.showType ? `<th scope="col">Type</th>` : ""}<th scope="col">Value</th><th scope="col"><span class="sr-only">Copy</span></th></tr></thead>
              <tbody>
                ${section.rows.map((row, r) => `
                  <tr data-mv-row data-mv-search="${escapeHtml(`${row.field} ${row.key || ""} ${row.value}`.toLowerCase())}">
                    <th scope="row" class="mv-field">${escapeHtml(row.field)}${row.key && row.key !== row.field ? `<code class="mv-key">${escapeHtml(row.key)}</code>` : ""}</th>
                    ${section.showType ? `<td class="mv-type">${escapeHtml(row.type || "")}</td>` : ""}
                    <td class="mv-value">${row.value === "" ? `<span class="mv-empty">(empty)</span>` : escapeHtml(row.value)}${row.note ? `<span class="mv-note">${escapeHtml(row.note)}</span>` : ""}</td>
                    <td class="mv-copy-cell"><button class="btn btn-subtle btn-sm" type="button" data-mv-copy="${s}:${r}" aria-label="Copy value of ${escapeHtml(row.field)}">Copy</button></td>
                  </tr>`).join("")}
              </tbody>
            </table>` : ""}
            ${section.raw ? `<details class="mv-raw"><summary>Raw XML</summary><pre>${escapeHtml(section.raw)}</pre></details>` : ""}
          </details>`).join("");
        results.hidden = false;
        noMatch.hidden = true;
      }

      function applyFilter() {
        const q = filterInput.value.trim().toLowerCase();
        let any = false;
        sectionsEl.querySelectorAll("[data-mv-section]").forEach((sec) => {
          let shown = 0;
          sec.querySelectorAll("[data-mv-row]").forEach((tr) => {
            const hit = !q || tr.dataset.mvSearch.includes(q);
            tr.hidden = !hit;
            if (hit) shown++;
          });
          sec.hidden = q && !shown;
          if (q && shown) sec.open = true;
          if (shown) any = true;
        });
        noMatch.hidden = any || !q;
      }
    },
  });

  // ---------- readers ----------

  function fileSection(file) {
    const rows = [
      { field: "File name", value: file.name },
      { field: "Size", value: `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)` },
      { field: "Type", value: file.type || "(not reported by the browser)" },
    ];
    if (file.lastModified) {
      rows.push({ field: "Last modified on this computer", value: new Date(file.lastModified).toLocaleString(), note: "From your file system, not from inside the file." });
    }
    return { title: "File", rows };
  }

  async function loadZip(buffer) {
    if (!window.JSZip) throw new Error("the zip library didn't load — check your connection and reload the page");
    return JSZip.loadAsync(buffer);
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return null;
    return doc;
  }

  async function readPart(zip, path) {
    const entry = zip.file(path);
    if (!entry) return null;
    const text = await entry.async("string");
    return { text, doc: parseXml(text) };
  }

  async function readOoxml(zip) {
    const sections = [];

    const core = await readPart(zip, "docProps/core.xml");
    if (core && core.doc) {
      const rows = elementChildren(core.doc.documentElement).map((el) => {
        const value = textOf(el);
        return {
          field: CORE_LABELS[el.localName] || humanize(el.localName),
          key: el.tagName,
          value,
          note: isDateLike(el, value) ? localDate(value) : "",
        };
      });
      sections.push({ title: "Summary properties", source: "docProps/core.xml", description: "Title, author, dates, and revision — the Summary tab in Word's Advanced Properties.", rows, raw: core.text });
    } else {
      sections.push({ title: "Summary properties", source: "docProps/core.xml", description: "This file has no summary properties part. That's common for files exported from Google Docs, Sheets, or Slides, or scrubbed of metadata.", rows: [], keepEmpty: true });
    }

    const custom = await readPart(zip, "docProps/custom.xml");
    if (custom && custom.doc) {
      const rows = elementChildren(custom.doc.documentElement)
        .filter((el) => el.localName === "property")
        .map((el) => {
          const valueEl = elementChildren(el)[0];
          const vt = valueEl ? valueEl.localName : "";
          let value = valueEl ? vtValue(valueEl) : "";
          let note = "";
          if (vt === "filetime" || vt === "date") note = localDate(value);
          if (vt === "bool") value = /^(true|1)$/i.test(value) ? "Yes" : "No";
          if (!note && /^\d{4}-\d{2}-\d{2}T/.test(value)) note = localDate(value);
          return { field: el.getAttribute("name") || "(unnamed)", type: VT_TYPES[vt] || vt, value, note };
        });
      sections.unshift({ title: "Custom properties", source: "docProps/custom.xml", description: "Named fields added by the app or service that created the file — the Custom tab in Word's Advanced Properties.", rows, showType: true, raw: custom.text });
    } else {
      sections.unshift({ title: "Custom properties", source: "docProps/custom.xml", description: "This file has no custom properties.", rows: [], keepEmpty: true });
    }

    const app = await readPart(zip, "docProps/app.xml");
    if (app && app.doc) {
      const rows = elementChildren(app.doc.documentElement).map((el) => ({
        field: humanize(el.localName),
        key: el.localName,
        value: el.localName === "HeadingPairs" || el.localName === "TitlesOfParts" ? vectorText(el) : (elementChildren(el).length ? vectorText(el) : textOf(el)),
      }));
      sections.push({ title: "Application properties", source: "docProps/app.xml", description: "Statistics and settings recorded by the app that saved the file (word count, template, app version).", rows, raw: app.text, collapsed: true });
    }

    const label = await readPart(zip, "docMetadata/LabelInfo.xml");
    if (label && label.doc) {
      sections.push({ title: "Sensitivity labels", source: "docMetadata/LabelInfo.xml", description: "Microsoft Purview / Information Protection labels applied to the file.", rows: flatten(label.doc.documentElement), raw: label.text });
    }

    // Word-specific
    const settings = await readPart(zip, "word/settings.xml");
    if (settings && settings.doc) {
      const vars = Array.from(settings.doc.getElementsByTagNameNS("*", "docVar")).map((el) => ({
        field: attr(el, "name") || "(unnamed)",
        value: attr(el, "val"),
      }));
      if (vars.length) sections.push({ title: "Document variables", source: "word/settings.xml", description: "Hidden variables stored by templates, add-ins, or macros. Word doesn't show these anywhere in its interface.", rows: vars });
      const rsids = settings.doc.getElementsByTagNameNS("*", "rsid").length;
      const flags = [];
      if (settings.doc.getElementsByTagNameNS("*", "removePersonalInformation").length) flags.push({ field: "Remove personal information on save", value: "On" });
      if (settings.doc.getElementsByTagNameNS("*", "trackRevisions").length) flags.push({ field: "Track changes", value: "On" });
      const prot = settings.doc.getElementsByTagNameNS("*", "documentProtection")[0];
      if (prot) flags.push({ field: "Document protection", value: attr(prot, "edit") || "on", note: attr(prot, "enforcement") === "1" || attr(prot, "enforcement") === "true" ? "Enforced" : "Not enforced" });
      const attached = settings.doc.getElementsByTagNameNS("*", "attachedTemplate")[0];
      if (attached) {
        const relId = attached.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        const rels = relId ? await readPart(zip, "word/_rels/settings.xml.rels") : null;
        const target = rels && rels.doc ? Array.from(rels.doc.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === relId) : null;
        flags.push({ field: "Attached template", value: target ? target.getAttribute("Target") : relId });
      }
      if (rsids) flags.push({ field: "Editing sessions recorded (rsids)", value: String(rsids), note: "Each save session Word tracks gets an ID; a high count suggests a long editing history." });
      if (flags.length) sections.push({ title: "Word settings", source: "word/settings.xml", rows: flags, collapsed: true });
    }

    const people = await collectAuthors(zip);
    if (people.length) {
      sections.push({ title: "People in comments & tracked changes", description: "Names stored with comments and tracked insertions, deletions, and formatting changes.", rows: people });
    }

    // customXml items (e.g. SharePoint content-type fields, cover-page data)
    const itemPaths = Object.keys(zip.files).filter((p) => /^customXml\/item\d+\.xml$/i.test(p)).sort(naturalSort);
    for (const path of itemPaths) {
      const part = await readPart(zip, path);
      if (!part || !part.doc) continue;
      const propsPath = path.replace(/item(\d+)\.xml$/i, "itemProps$1.xml");
      const props = await readPart(zip, propsPath);
      const schemas = props && props.doc ? Array.from(props.doc.getElementsByTagNameNS("*", "schemaRef")).map((s) => attr(s, "uri")).filter(Boolean) : [];
      const rootEl = part.doc.documentElement;
      sections.push({
        title: `Custom XML: ${rootEl.localName}`,
        source: path,
        description: schemas.length ? `Schema: ${schemas.join(", ")}` : (rootEl.namespaceURI ? `Namespace: ${rootEl.namespaceURI}` : ""),
        rows: flatten(rootEl),
        raw: part.text,
        collapsed: true,
      });
    }

    // Package inventory
    const parts = Object.values(zip.files).filter((f) => !f.dir).sort((a, b) => naturalSort(a.name, b.name));
    sections.push({
      title: "Package contents",
      description: "Every part inside the file (an Office document is a zip archive).",
      rows: parts.map((f) => ({
        field: f.name,
        value: f._data && typeof f._data.uncompressedSize === "number" ? formatBytes(f._data.uncompressedSize) : "",
        note: f.date ? `Zip timestamp: ${f.date.toLocaleString()}` : "",
      })),
      collapsed: true,
    });

    return sections;
  }

  async function collectAuthors(zip) {
    const counts = new Map();
    const paths = Object.keys(zip.files).filter((p) => /^(word\/(document|comments|footnotes|endnotes|header\d*|footer\d*)\.xml|xl\/(comments\d*|threadedComments\/[^/]+)\.xml|ppt\/(commentAuthors|authors)\.xml|ppt\/comments\/[^/]+\.xml)$/i.test(p));
    for (const path of paths) {
      const text = await zip.file(path).async("string");
      for (const m of text.matchAll(/\b(?:w:author|author)="([^"]*)"/g)) {
        const kind = /comment/i.test(path) ? "comment" : "tracked change";
        bump(counts, decodeEntities(m[1]), kind);
      }
      for (const m of text.matchAll(/<(?:\w+:)?author>([^<]*)<\/(?:\w+:)?author>/g)) bump(counts, decodeEntities(m[1]), "comment");
      for (const m of text.matchAll(/<p188:author\b[^>]*name="([^"]*)"/g)) bump(counts, decodeEntities(m[1]), "comment");
    }
    const peoplePart = await readPart(zip, "word/people.xml");
    if (peoplePart && peoplePart.doc) {
      for (const p of peoplePart.doc.getElementsByTagNameNS("*", "person")) {
        const name = attr(p, "author");
        const presence = p.getElementsByTagNameNS("*", "presenceInfo")[0];
        if (name && !counts.has(name)) counts.set(name, {});
        if (name && presence) counts.get(name).__id = `${attr(presence, "providerId")}: ${attr(presence, "userId")}`;
      }
    }
    return Array.from(counts.entries()).filter(([name]) => name).map(([name, c]) => ({
      field: name,
      value: Object.entries(c).filter(([k]) => k !== "__id").map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ") || "Listed in word/people.xml",
      note: c.__id || "",
    }));
  }

  function bump(map, name, kind) {
    if (!map.has(name)) map.set(name, {});
    const c = map.get(name);
    c[kind] = (c[kind] || 0) + 1;
  }

  async function readPdf(buffer) {
    if (!ns.extractPdfMetadata) throw new Error("PDF support didn't load");
    const { info, xmp, pageCount } = await ns.extractPdfMetadata(buffer);
    const sections = [];
    const rows = [];
    const customRows = [];
    for (const [key, value] of Object.entries(info)) {
      if (key === "Custom" && value && typeof value === "object") {
        for (const [ck, cv] of Object.entries(value)) customRows.push({ field: ck, value: pdfValue(cv) });
        continue;
      }
      const str = pdfValue(value);
      rows.push({ field: humanize(key), key, value: str, note: /Date$/.test(key) ? pdfDate(str) : "" });
    }
    rows.push({ field: "Page count", value: String(pageCount) });
    sections.push({ title: "Custom properties", source: "Info dictionary", description: customRows.length ? "Non-standard keys added to the PDF's Info dictionary." : "This PDF has no custom Info keys.", rows: customRows, keepEmpty: true });
    sections.push({ title: "Document information", source: "Info dictionary", rows });
    if (xmp) {
      const doc = parseXml(xmp);
      const xmpRows = doc ? flatten(doc.documentElement).filter((r) => !/^(rdf:Description|rdf:RDF|x:xmpmeta)$/.test(r.field)) : [];
      sections.push({ title: "XMP metadata", source: "XMP packet", description: "Extended metadata embedded as XML (often includes creator tool, document IDs, and edit history).", rows: xmpRows, raw: xmp, collapsed: !xmpRows.length });
    }
    return sections;
  }

  // ---------- helpers ----------

  function elementChildren(el) {
    return Array.from(el.children || []);
  }

  function textOf(el) {
    return (el.textContent || "").trim();
  }

  function attr(el, localName) {
    for (const a of el.attributes) if (a.localName === localName) return a.value;
    return "";
  }

  function vtValue(el) {
    if (el.localName === "vector" || el.localName === "array") return vectorText(el);
    return el.textContent || "";
  }

  function vectorText(el) {
    const leaves = Array.from(el.getElementsByTagName("*")).filter((e) => !e.children.length).map((e) => (e.textContent || "").trim());
    return leaves.filter((v, i) => v !== "" || i === 0).join("; ");
  }

  // Generic XML → rows: one row per leaf element (path → text) and per attribute.
  function flatten(rootEl) {
    const rows = [];
    function walk(el, path) {
      const name = el.tagName;
      const here = path ? `${path} › ${name}` : name;
      for (const a of el.attributes) {
        if (a.name.startsWith("xmlns") || a.namespaceURI === XSI) continue;
        rows.push({ field: `${here} @${a.name}`, value: a.value });
      }
      const kids = elementChildren(el);
      if (!kids.length) {
        const text = textOf(el);
        if (text || !el.attributes.length) rows.push({ field: here, value: text });
        return;
      }
      for (const k of kids) walk(k, here);
    }
    walk(rootEl, "");
    // Trim the shared root prefix so long paths stay readable.
    const prefix = `${rootEl.tagName} › `;
    rows.forEach((r) => { if (r.field.startsWith(prefix)) r.field = r.field.slice(prefix.length); });
    return rows;
  }

  function humanize(name) {
    return String(name)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  }

  function isDateLike(el, value) {
    return /^(created|modified|lastPrinted)$/.test(el.localName) || (el.getAttributeNS(XSI, "type") || "").includes("W3CDTF") || /^\d{4}-\d{2}-\d{2}T/.test(value);
  }

  function localDate(value) {
    const d = new Date(value);
    return isNaN(d) ? "" : `Your local time: ${d.toLocaleString()}`;
  }

  function pdfValue(v) {
    if (v == null) return "";
    if (typeof v === "object") return v.name || JSON.stringify(v);
    return String(v);
  }

  // PDF dates look like D:20240115103000-07'00'
  function pdfDate(s) {
    const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s || "");
    if (!m) return "";
    const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00", tz, th = "00", tm = "00"] = m;
    const zone = !tz || /z/i.test(tz) ? "Z" : `${tz}${th}:${tm}`;
    return localDate(`${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`);
  }

  function decodeEntities(s) {
    return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true });
  }

  function toJson(current) {
    const out = { file: current.fileName };
    for (const s of current.sections) {
      if (!s.rows.length) continue;
      const obj = {};
      for (const r of s.rows) {
        const k = obj[r.field] === undefined ? r.field : `${r.field} (${Object.keys(obj).length})`;
        obj[k] = r.value;
      }
      out[s.title] = obj;
    }
    return out;
  }

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1200);
  }
})();
