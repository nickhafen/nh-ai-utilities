// Filename helpers for the Batch Download workflow (js/tools/batch-download.js).
// Pure functions: they turn a link's visible text and URL into a Windows-safe
// filename + extension, and validate rows the user has edited. The PowerShell
// script (js/shared/batch-download-script.js) repeats the same rules, because
// a user can hand-edit files.csv; keep the two in step.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  const ALLOWED_EXTS = [
    "pdf", "doc", "docx", "rtf", "odt", "txt", "md", "csv",
    "xls", "xlsx", "ods", "ppt", "pptx", "odp",
    "jpg", "jpeg", "png", "gif", "tif", "tiff", "webp",
    "mp3", "mp4", "m4a", "wav", "zip",
  ];
  const ALLOWED = new Set(ALLOWED_EXTS);
  const WARN_EXTS = new Set(["zip"]);
  const WEBPAGE_EXTS = new Set(["htm", "html", "shtml", "xhtml", "asp", "aspx", "php", "jsp", "jspx", "cfm", "cgi", "pl"]);
  const RESERVED = new Set([
    "CON", "PRN", "AUX", "NUL",
    ..."123456789".split("").map((d) => `COM${d}`),
    ..."123456789".split("").map((d) => `LPT${d}`),
  ]);

  const MAX_LENGTH = 150;       // name + "." + ext
  const MAX_LABEL_LENGTH = 120; // longer link text is probably a whole linked paragraph
  const PDF_PLACEHOLDER = "[Feature unavailable for PDFs]";
  const INVALID_CHARS_RE = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
  const INVALID_CHARS_LIST = '\\ / : * ? " < > |';
  const FORMULA_START_RE = /^[=+\-@]/;
  const EXT_RE = /\.([A-Za-z0-9]{1,10})$/;

  // Decodes HTML/XML entities (&quot;, &#233;, …) as text. DOMParser never
  // runs scripts or loads resources, and only textContent is read back.
  function decodeEntities(value) {
    const s = String(value || "");
    if (!s.includes("&")) return s;
    try {
      return new DOMParser().parseFromString(`<!doctype html><body>${s.replace(/</g, "&lt;")}`, "text/html").body.textContent;
    } catch {
      return s;
    }
  }

  function safeDecode(value) {
    try { return decodeURIComponent(value); } catch { return value; }
  }

  // Last non-empty path segment of a URL, percent-decoded ("" if none).
  function urlLastSegment(url) {
    try {
      const segments = new URL(url).pathname.split("/").filter(Boolean);
      return segments.length ? safeDecode(segments[segments.length - 1]) : "";
    } catch {
      return "";
    }
  }

  function splitExt(name) {
    const m = String(name).match(EXT_RE);
    return m ? { base: name.slice(0, -m[0].length), ext: m[1].toLowerCase() } : { base: name, ext: "" };
  }

  // Extension for a URL: from the last path segment, else from a query value
  // that looks like a filename (e.g. ?file=report.pdf), else "auto" (the
  // script works the type out after downloading).
  // `source` is "path" | "query" | "none"; `pathLike` is true when the URL
  // path looks like a web page folder ("/", "/en/about/").
  function detectExtension(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return { ext: "auto", source: "none", pathLike: false }; }
    const pathExt = splitExt(urlLastSegment(url)).ext;
    if (pathExt) return { ext: pathExt, source: "path", pathLike: false };
    for (const value of parsed.searchParams.values()) {
      const qExt = splitExt(value.trim()).ext;
      if (qExt && (ALLOWED.has(qExt) || WEBPAGE_EXTS.has(qExt))) return { ext: qExt, source: "query", pathLike: false };
    }
    const pathLike = parsed.pathname === "" || parsed.pathname.endsWith("/");
    return { ext: "auto", source: "none", pathLike };
  }

  // "document" (allowed type) | "page" (web page) | "unknown" (no type
  // found) | "blocked" (a type this tool won't download).
  function classifyExtension(ext, pathLike) {
    if (ext === "auto") return pathLike ? "page" : "unknown";
    if (ALLOWED.has(ext)) return "document";
    if (WEBPAGE_EXTS.has(ext)) return "page";
    return "blocked";
  }

  // Applies the filename cleanup rules to already-decoded text. Returns the
  // cleaned name and a list of notable changes ("formula", "shortened").
  function sanitizeName(value, { maxBase = MAX_LENGTH, fallback = "file" } = {}) {
    const notes = [];
    let name = String(value || "").replace(/\s+/g, " ").trim();
    name = name.replace(/[\\/]/g, "-");
    name = name.replace(/[:*?"<>|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    name = name.replace(/[. ]+$/, "");
    if (FORMULA_START_RE.test(name)) {
      name = `_${name}`;
      notes.push("formula");
    }
    if (name.length > maxBase) {
      name = name.slice(0, maxBase).replace(/[. ]+$/, "");
      notes.push("shortened");
    }
    if (!name) name = fallback;
    return { name, notes };
  }

  function looksLikeUrl(text, url) {
    const t = text.trim();
    if (!t) return false;
    if (/^(https?:\/\/|www\.)/i.test(t)) return true;
    const strip = (s) => s.replace(/\/+$/, "").toLowerCase();
    return strip(t) === strip(url);
  }

  // True when link text is good enough to name a file: not empty, not the
  // PDF placeholder, not a whole paragraph, and not just the URL again.
  function hasUsableLabel(visibleText, url) {
    const label = decodeEntities(visibleText || "").replace(/\s+/g, " ").trim();
    return !!label &&
      label !== PDF_PLACEHOLDER &&
      label.length <= MAX_LABEL_LENGTH &&
      !looksLikeUrl(label, url);
  }

  // Key shared by the same file offered in several formats, e.g.
  // .../CLAD_2272-23_ES.PDF and .../CLAD_2272-23_ES.docx. The URL minus the
  // extension of its last segment, lowercased; "" when there's no extension.
  function formatGroupKey(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return ""; }
    const m = parsed.pathname.match(/\.([A-Za-z0-9]{1,10})$/);
    if (!m) return "";
    return `${parsed.origin}${parsed.pathname.slice(0, -m[0].length)}${parsed.search}`.toLowerCase();
  }

  // Suggested { filename, ext, notes, source } for one link.
  // nameFrom: "text" (link text, the default) or "url" (URL filename).
  // n: 1-based row number, used for the "file-<n>" fallback.
  function suggest(visibleText, url, { nameFrom = "text", n = 1 } = {}) {
    const detected = detectExtension(url);
    const ext = detected.ext;
    const label = decodeEntities(visibleText || "").replace(/\s+/g, " ").trim();
    const useUrl = nameFrom === "url" || !hasUsableLabel(label, url);

    let raw = useUrl ? splitExt(urlLastSegment(url)).base : label;
    // Don't double the extension ("report.pdf" + ".pdf").
    if (ext !== "auto") {
      const own = splitExt(raw);
      if (own.ext === ext) raw = own.base;
    }
    const maxBase = MAX_LENGTH - (ext === "auto" ? 0 : ext.length + 1);
    const { name, notes } = sanitizeName(raw, { maxBase, fallback: `file-${n}` });
    return { filename: name, ext, notes, kind: classifyExtension(ext, detected.pathLike) };
  }

  function fullName(filename, ext) {
    return ext && ext !== "auto" ? `${filename}.${ext}` : filename;
  }

  function isReserved(filename) {
    const stem = String(filename).split(".")[0].trim().toUpperCase();
    return RESERVED.has(stem);
  }

  // Problems with one row's current values. Returns
  // { errors: [{code, message, fixable}], warnings: [{code, message}] }.
  // `duplicate` is computed by the caller across checked rows.
  function validate({ filename, ext, url, notes = [], duplicate = false, relative = false }) {
    const errors = [];
    const warnings = [];
    const name = String(filename || "");
    const e = String(ext || "").toLowerCase();

    if (relative) {
      errors.push({ code: "relative", message: "This link is relative and needs the page's address. Enter it in Base URL above." });
    }
    if (!name.trim()) {
      errors.push({ code: "empty", message: "Enter a filename.", fixable: false });
    } else {
      if (INVALID_CHARS_RE.test(name)) {
        errors.push({ code: "chars", message: `Windows doesn't allow these characters in filenames: ${INVALID_CHARS_LIST}`, fixable: true });
      }
      if (/[. ]$/.test(name) || /^\s/.test(name)) {
        errors.push({ code: "edges", message: "Filenames can't start with a space or end with a dot or space.", fixable: true });
      }
      if (FORMULA_START_RE.test(name)) {
        errors.push({ code: "formula", message: "Names can't start with = + - or @, because spreadsheets treat them as formulas.", fixable: true });
      }
      if (isReserved(name)) {
        errors.push({ code: "reserved", message: `"${name.split(".")[0].trim()}" is reserved by Windows. Choose a different name.`, fixable: false });
      }
      if (fullName(name, e).length > MAX_LENGTH) {
        errors.push({ code: "length", message: `Name is too long: keep it to ${MAX_LENGTH} characters or fewer, including the extension.`, fixable: true });
      }
    }

    if (e === "auto") {
      warnings.push({ code: "auto", message: "No file type in the URL. The script will work out the type after downloading, and skips the file if it isn't an allowed type." });
    } else if (!/^[a-z0-9]{1,10}$/.test(e)) {
      errors.push({ code: "ext-invalid", message: "Choose a file type from the list." });
    } else if (!ALLOWED.has(e)) {
      errors.push({ code: "ext-blocked", message: `.${e} files can't be downloaded with this tool, for safety. Uncheck this row.` });
    } else if (WARN_EXTS.has(e)) {
      warnings.push({ code: "zip", message: "Zip files can contain anything; open with care." });
    }

    if (duplicate) {
      errors.push({ code: "duplicate", message: "Another checked row uses this name. Filenames must be unique (capital letters don't count as a difference).", fixable: false });
    }
    if (notes.includes("shortened")) {
      warnings.push({ code: "shortened", message: `Name shortened to ${MAX_LENGTH} characters to stay within Windows path limits.` });
    }
    if (notes.includes("formula")) {
      warnings.push({ code: "formula-fixed", message: "Name starts with a character spreadsheets treat as a formula; a leading _ was added." });
    }
    if (/^http:/i.test(url || "")) {
      warnings.push({ code: "http", message: "This link isn't encrypted (http). It will still download." });
    }
    return { errors, warnings };
  }

  // "Fix automatically": the same cleanup as a suggestion, applied to the
  // user's text, then the reserved-name and length rules.
  function fix(filename, ext) {
    const e = ext && ext !== "auto" ? ext : "";
    let { name } = sanitizeName(filename, { maxBase: MAX_LENGTH - (e ? e.length + 1 : 0), fallback: "file" });
    if (e) {
      const own = splitExt(name);
      if (own.ext === e) name = own.base;
    }
    if (isReserved(name)) name = `_${name}`;
    return name;
  }

  // Case-insensitive key for duplicate detection.
  function duplicateKey(filename, ext) {
    return fullName(String(filename || "").trim(), ext).toLowerCase();
  }

  ns.filenames = {
    ALLOWED_EXTS,
    MAX_LENGTH,
    PDF_PLACEHOLDER,
    isAllowedExt: (ext) => ALLOWED.has(ext),
    isWebpageExt: (ext) => WEBPAGE_EXTS.has(ext),
    decodeEntities,
    urlLastSegment,
    splitExt,
    detectExtension,
    classifyExtension,
    sanitizeName,
    hasUsableLabel,
    formatGroupKey,
    suggest,
    fullName,
    isReserved,
    validate,
    fix,
    duplicateKey,
  };
})();
