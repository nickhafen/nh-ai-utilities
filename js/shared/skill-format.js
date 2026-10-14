// SKILL.md rules and file import for SKILL Creator: name/description
// validation, a small frontmatter reader, and turning an uploaded .md, .txt,
// or .docx into { name, description, extraFields, body } plus notes on what
// was found or fixed. No DOM work here beyond DOMParser, so tests can call it.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  // -- Validation (Agent Skills spec: agentskills.io/specification) --

  const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  const BODY_LINE_LIMIT = 500;

  function validateName(name) {
    if (!name) return "Name is required.";
    if (name.length > 64) return "Name must be 64 characters or fewer.";
    if (!NAME_RE.test(name)) return "Use lowercase letters, numbers, and hyphens only — must not start or end with a hyphen.";
    if (name.includes("--")) return "Name must not contain two hyphens in a row.";
    return null;
  }

  function validateDescription(description) {
    if (!description) return "Description is required.";
    if (description.length > 1024) return "Description must be 1024 characters or fewer.";
    return null;
  }

  // Not spec errors, but Claude rejects uploads that break them.
  function platformWarnings(name, description) {
    const out = [];
    if (/anthropic|claude/.test(name || "")) out.push("Claude won't accept a skill name containing “anthropic” or “claude”.");
    if (/<\/?[A-Za-z][^>]*>/.test(description || "")) out.push("Claude won't accept a description containing XML/HTML tags like <tag>.");
    return out;
  }

  // "My Skill (v2)" -> "my-skill-v2". Accents are dropped, runs of anything
  // else become one hyphen, and the result is cut to 64 characters.
  function toSkillName(value) {
    return String(value || "")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/, "");
  }

  // -- Frontmatter --

  // Delimiters: "---", plus the en/em dashes Word autocorrects it into.
  const DELIM = /^\s*(?:-{3,}|[–—]+-?)\s*$/;
  const KEY_LINE = /^([A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;

  // Frontmatter keys from the Agent Skills spec and Claude Code. Without
  // "---" delimiters (common in .txt and Word files), only lines starting
  // with one of these count as frontmatter, so a body that opens with
  // "Note: ..." stays in the body.
  const KNOWN_KEYS = new Set([
    "name", "description", "license", "compatibility", "metadata", "allowed-tools",
    "version", "author", "argument-hint", "when_to_use", "disable-model-invocation",
    "user-invocable", "model", "context", "agent",
  ]);

  // Finds frontmatter at the top of `lines`. Returns { lines, consumed,
  // delimited } (consumed = how many input lines it covers) or null.
  function findFrontmatter(lines) {
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) return null;

    if (DELIM.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        if (DELIM.test(lines[j])) return { lines: lines.slice(i + 1, j), consumed: j + 1, delimited: true };
      }
      return null;
    }

    const isKnownKey = (line) => KNOWN_KEYS.has(((line.match(KEY_LINE) || [])[1] || "").toLowerCase());
    if (!isKnownKey(lines[i])) return null;
    // Known-key lines, the indented lines right under them, and blank lines
    // between them (Word files often have spacing paragraphs).
    let end = i;
    for (let j = i; j < lines.length; j++) {
      if (isKnownKey(lines[j])) end = j + 1;
      else if (!lines[j].trim()) continue;
      else if (/^\s/.test(lines[j]) && end === j) end = j + 1;
      else break;
    }
    const block = lines.slice(i, end);
    const keys = block.map((l) => ((l.match(KEY_LINE) || [])[1] || "").toLowerCase());
    if (!keys.includes("name") && !keys.includes("description")) return null;
    // Swallow a lone closing delimiter, e.g. when the opening "---" became a Word border.
    let k = end;
    while (k < lines.length && !lines[k].trim()) k++;
    return { lines: block, consumed: k < lines.length && DELIM.test(lines[k]) ? k + 1 : end, delimited: false };
  }

  function unquote(value) {
    const s = String(value || "").trim();
    let m;
    if ((m = s.match(/^"([\s\S]*)"$/))) return m[1].replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t" }[c] || c));
    if ((m = s.match(/^'([\s\S]*)'$/))) return m[1].replace(/''/g, "'");
    if ((m = s.match(/^[“”]([\s\S]*)[“”]$/)) || (m = s.match(/^[‘’]([\s\S]*)[‘’]$/))) return m[1];
    return s;
  }

  function dedent(lines) {
    const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
    const cut = indents.length ? Math.min(...indents) : 0;
    return lines.map((l) => l.slice(cut));
  }

  // Reads the subset of YAML that skill frontmatter uses: `key: value`,
  // quoted values, plain values wrapped onto indented lines, `|` and `>`
  // block text, lists (flattened to "a, b"), and one level of nested
  // `key:` blocks (kept as a group, like `metadata:`). Returns
  // { name, description, extraFields, notes }.
  function parseFrontmatter(lines) {
    const out = { name: "", description: "", extraFields: [], notes: [] };
    const dropped = [];
    const flattened = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) { i++; continue; }
      const m = /^\s/.test(line) ? null : line.match(KEY_LINE);
      i++;
      if (!m) { dropped.push(line.trim()); continue; }

      const key = m[1];
      const rest = (m[2] || "").trim();
      const kids = [];
      while (i < lines.length && (/^\s/.test(lines[i]) || !lines[i].trim() || (!rest && /^-(\s|$)/.test(lines[i])))) kids.push(lines[i++]);
      while (kids.length && !kids[kids.length - 1].trim()) kids.pop();

      let field = { name: key, kind: "text", value: "", subFields: [] };
      if (/^[|>][+-]?\d*$/.test(rest)) {
        const body = dedent(kids);
        field.value = (rest[0] === "|" ? body.join("\n") : body.map((l) => l.trim()).join(" ")).trim();
      } else if (rest) {
        const joined = [rest, ...kids.map((k) => k.trim())].join(" ");
        const flow = joined.match(/^\[([\s\S]*)\]$/);
        if (flow) flattened.push(key);
        field.value = flow ? flow[1].split(",").map(unquote).filter(Boolean).join(", ") : unquote(joined);
      } else if (kids.length && kids.every((k) => !k.trim() || /^\s*-(\s|$)/.test(k))) {
        flattened.push(key);
        field.value = kids.filter((k) => k.trim()).map((k) => unquote(k.replace(/^\s*-\s*/, ""))).join(", ");
      } else if (kids.length) {
        field.kind = "group";
        for (const k of dedent(kids)) {
          const sm = k.match(KEY_LINE);
          if (sm) field.subFields.push({ name: sm[1], value: unquote(sm[2] || "") });
          else if (k.trim()) dropped.push(k.trim());
        }
      }

      const lower = key.toLowerCase();
      if (lower === "name" && !out.name) out.name = field.value;
      else if (lower === "description" && !out.description) out.description = field.value.replace(/\s+/g, " ").trim();
      else out.extraFields.push(field);
    }
    if (flattened.length) out.notes.push({ level: "warn", text: `List values in ${flattened.map((k) => `“${k}”`).join(", ")} were turned into comma-separated text. Check they read correctly under Additional metadata fields.` });
    if (dropped.length) out.notes.push({ level: "warn", text: `Skipped ${dropped.length} frontmatter line${dropped.length === 1 ? "" : "s"} that couldn't be read: “${dropped[0].slice(0, 60)}”${dropped.length > 1 ? " …" : ""}` });
    return out;
  }

  // -- Import --

  const IGNORED_STEMS = /^(skill|readme|untitled|document\d*|new document)$/i;

  // A name for a file with no `name:` field: its first "# Heading", else
  // the file name ("Research Summary.docx" -> "research-summary").
  function suggestName(body, fileName) {
    const heading = (body.match(/^#[ \t]+(.+?)[ \t#]*$/m) || [])[1];
    const stem = String(fileName || "").replace(/\.[^.]+$/, "");
    for (const candidate of [heading, stem]) {
      if (!candidate || IGNORED_STEMS.test(candidate.trim())) continue;
      const slug = toSkillName(candidate.replace(/[*_`]/g, ""));
      if (slug) return { name: slug, from: candidate === heading ? "heading" : "filename", original: candidate.trim() };
    }
    return null;
  }

  // Splits text into frontmatter + body and fills in the result fields.
  function fromLines(lines, fileName, notes) {
    const fm = findFrontmatter(lines);
    const meta = fm ? parseFrontmatter(fm.lines) : { name: "", description: "", extraFields: [], notes: [] };
    const body = lines.slice(fm ? fm.consumed : 0).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return finish({ ...meta, body, frontmatter: fm ? (fm.delimited ? "delimited" : "undelimited") : null }, fileName, notes);
  }

  function finish(result, fileName, notes) {
    notes.push(...result.notes);
    if (result.frontmatter === "delimited") {
      notes.push({ level: "ok", text: "Found YAML frontmatter." });
    } else if (result.frontmatter === "undelimited") {
      notes.push({ level: "fixed", text: "Found name/description lines at the top without “---” markers and moved them into the frontmatter." });
    } else {
      notes.push({ level: "fixed", text: "No frontmatter found, so one will be added from the fields above." });
    }

    let name = result.name.trim();
    if (name) {
      const fixed = toSkillName(name);
      if (fixed !== name) {
        notes.push({ level: "fixed", text: `Renamed “${name}” to “${fixed}” to fit skill-name rules.` });
        name = fixed;
      }
    } else {
      const suggested = suggestName(result.body, fileName);
      if (suggested) {
        name = suggested.name;
        notes.push({ level: "warn", text: `No name in the file, so “${name}” was made from the ${suggested.from === "heading" ? "first heading" : "file name"}. Check it.` });
      }
    }

    return { name, description: result.description, extraFields: result.extraFields, body: result.body, notes };
  }

  function readTextFile(text, fileName) {
    const clean = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/ /g, " ");
    return fromLines(clean.split("\n"), fileName, []);
  }

  function paragraphLines(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    return clone.textContent.replace(/ /g, " ").split("\n");
  }

  // Word users often paste Markdown in as plain paragraphs ("## Steps",
  // "- item"). Converting that as formatted text would escape every "#" and
  // "-", so when a document has no real headings or lists but several
  // Markdown-looking lines, its paragraph text is used as the Markdown.
  function looksLikeTypedMarkdown(doc) {
    if (doc.querySelector("h1,h2,h3,h4,h5,h6,ul,ol,table")) return false;
    const marked = [...doc.body.querySelectorAll("p")]
      .filter((p) => /^(#{1,6}\s|[-*+]\s|\d+\.\s|```|>\s)/.test(p.textContent.trim()));
    return marked.length >= 2;
  }

  // `html` is Mammoth output with empty paragraphs kept (they are the blank
  // lines when the document holds typed Markdown).
  function readDocxHtml(html, fileName) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const notes = [];

    if (looksLikeTypedMarkdown(doc)) {
      notes.push({ level: "ok", text: "This Word file contains Markdown typed as plain text, so it was used as-is." });
      const lines = [...doc.body.children].flatMap(paragraphLines);
      return fromLines(lines, fileName, notes);
    }

    notes.push({ level: "ok", text: "Converted the Word formatting (headings, lists, bold, tables, links) to Markdown." });
    // Frontmatter can only be in the leading plain paragraphs.
    const entries = [];
    for (const el of doc.body.children) {
      if (el.tagName !== "P") break;
      for (const line of paragraphLines(el)) entries.push({ el, line });
    }
    const fm = findFrontmatter(entries.map((e) => e.line));
    const meta = fm ? parseFrontmatter(fm.lines) : { name: "", description: "", extraFields: [], notes: [] };
    if (fm) new Set(entries.slice(0, fm.consumed).map((e) => e.el)).forEach((el) => el.remove());
    doc.body.querySelectorAll("p").forEach((p) => { if (!p.textContent.trim() && !p.querySelector("img")) p.remove(); });
    const body = ns.makeTurndown().turndown(doc.body.innerHTML).replace(/\n{3,}/g, "\n\n").trim();
    return finish({ ...meta, body, frontmatter: fm ? (fm.delimited ? "delimited" : "undelimited") : null }, fileName, notes);
  }

  const ACCEPT = ".md,.markdown,.txt,.docx";

  // Reads an uploaded File. Resolves to { name, description, extraFields,
  // body, notes }; rejects with a user-facing message.
  async function importFile(file) {
    const lower = (file?.name || "").toLowerCase();
    if (/\.(md|markdown|txt)$/.test(lower)) return readTextFile(await file.text(), file.name);
    if (lower.endsWith(".docx")) {
      if (!window.mammoth || !window.TurndownService) throw new Error("The Word converter didn't load. Check your connection and refresh the page.");
      const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { ignoreEmptyParagraphs: false });
      return readDocxHtml(result.value, file.name);
    }
    if (lower.endsWith(".doc")) throw new Error("Older .doc files aren't supported. Open it in Word and save as .docx, then try again.");
    throw new Error("Choose a .docx, .md, or .txt file.");
  }

  ns.skillFormat = {
    ACCEPT,
    BODY_LINE_LIMIT,
    validateName,
    validateDescription,
    platformWarnings,
    toSkillName,
    findFrontmatter,
    parseFrontmatter,
    readTextFile,
    readDocxHtml,
    importFile,
  };
})();
