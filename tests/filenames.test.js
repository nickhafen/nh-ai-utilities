(function () {
  const ns = window.AiUtilities;
  const F = ns.filenames;
  const OAS = "https://www.oas.org/en/iachr/decisions/";

  // ── Suggested names ──────────────────────────────────────────────────────

  test("OAS PDF: slash in link text, uppercase extension", () => {
    const s = F.suggest("Report No. 238/24", `${OAS}2024/BRIN_804-19_EN.PDF`);
    eq(s.filename, "Report No. 238-24");
    eq(s.ext, "pdf");
    eq(s.kind, "document");
  });

  test("OAS DOCX", () => {
    const s = F.suggest("Report No. 119/24", `${OAS}2024/BRIN_1179-15_EN.docx`);
    eq(F.fullName(s.filename, s.ext), "Report No. 119-24.docx");
  });

  test("PDF placeholder label falls back to the URL filename", () => {
    const s = F.suggest(F.PDF_PLACEHOLDER, "https://x.org/files/Annual%20Report%202024.pdf");
    eq(s.filename, "Annual Report 2024");
  });

  test("label equal to the URL falls back to the URL filename", () => {
    const url = "https://x.org/a/b/brief.docx";
    eq(F.suggest(url, url).filename, "brief");
    eq(F.suggest("www.x.org/a/b/brief.docx", url).filename, "brief");
  });

  test("empty and overlong labels fall back to the URL filename", () => {
    eq(F.suggest("", "https://x.org/q.pdf").filename, "q");
    eq(F.suggest("x".repeat(121), "https://x.org/q.pdf").filename, "q");
    eq(F.suggest("x".repeat(120), "https://x.org/q.pdf").filename, "x".repeat(120));
  });

  test("nameFrom: url ignores the label", () => {
    eq(F.suggest("Nice title", "https://x.org/raw_name.pdf", { nameFrom: "url" }).filename, "raw_name");
  });

  test("entities are decoded before cleanup", () => {
    eq(F.suggest("The &quot;Quoted&quot; &lt;Doc&gt; &amp; more", "https://x.org/q.pdf").filename, "The Quoted Doc & more");
    eq(F.suggest("Caf&#233;", "https://x.org/q.pdf").filename, "Café");
  });

  test("entities are decoded once only", () => {
    eq(F.suggest("A &amp;lt; B", "https://x.org/q.pdf").filename, "A &lt; B");
  });

  test("invalid characters and control characters become spaces", () => {
    eq(F.suggest("a:b*c?d\"e<f>g|h\u0007i", "https://x.org/q.pdf").filename, "a b c d e f g h i");
  });

  test("backslash and slash become hyphens", () => {
    eq(F.suggest("a\\b/c", "https://x.org/q.pdf").filename, "a-b-c");
  });

  test("trailing dots and spaces are trimmed", () => {
    eq(F.suggest("Report...  ", "https://x.org/q.pdf").filename, "Report");
  });

  test("formula-like start gets a leading underscore", () => {
    const s = F.suggest("=HYPERLINK(1)", "https://x.org/q.xlsx");
    eq(s.filename, "_=HYPERLINK(1)");
    eq(s.notes, ["formula"]);
    for (const c of ["+", "-", "@"]) eq(F.suggest(`${c}x`, "https://x.org/q.pdf").filename, `_${c}x`);
  });

  test("empty result uses file-<n>", () => {
    eq(F.suggest("???", "https://x.org/", { n: 7 }).filename, "file-7");
  });

  test("extension isn't doubled", () => {
    const s = F.suggest("minutes.PDF", "https://x.org/m.pdf");
    eq(F.fullName(s.filename, s.ext), "minutes.pdf");
  });

  test("percent-encoded URL segment is decoded", () => {
    eq(F.suggest("", "https://x.org/Informe%20N%C2%BA%2012.pdf").filename, "Informe Nº 12");
  });

  test("encoded slash in URL segment becomes a hyphen", () => {
    eq(F.suggest("", "https://x.org/a%2Fb.pdf").filename, "a-b");
  });

  test("long names are shortened to fit 150 with the extension", () => {
    const s = F.suggest("", `https://x.org/${"a".repeat(200)}.docx`);
    eq(F.fullName(s.filename, s.ext).length, 150);
    eq(s.notes, ["shortened"]);
  });

  test("non-ASCII names survive", () => {
    eq(F.suggest("Informe Nº 12/24 – Perú", "https://x.org/q.pdf").filename, "Informe Nº 12-24 – Perú");
  });

  // ── Extensions and classification ────────────────────────────────────────

  test("extension from query string", () => {
    eq(F.detectExtension("https://x.org/get?file=annual%20report.pdf").ext, "pdf");
    eq(F.detectExtension("https://x.org/get?id=12").ext, "auto");
  });

  test("web pages and folders are classified as pages", () => {
    eq(F.suggest("About", "https://x.org/en/about.asp").kind, "page");
    eq(F.suggest("Home", "https://x.org/").kind, "page");
    eq(F.suggest("Section", "https://x.org/en/section/").kind, "page");
    eq(F.suggest("Search", "https://x.org/search.php?q=a.pdf").kind, "page");
  });

  test("no extension and no hint is unknown", () => {
    const s = F.suggest("Download", "https://x.org/download/12345");
    eq([s.ext, s.kind], ["auto", "unknown"]);
  });

  test("blocked types", () => {
    eq(F.suggest("Setup", "https://x.org/setup.EXE").kind, "blocked");
    eq(F.suggest("Link", "https://x.org/a.lnk").kind, "blocked");
  });

  // ── Validation ───────────────────────────────────────────────────────────

  const codes = (r) => [...r.errors.map((e) => e.code), ...r.warnings.map((w) => w.code)];

  test("clean row has no problems", () => {
    eq(codes(F.validate({ filename: "Report", ext: "pdf", url: "https://x.org/r.pdf" })), []);
  });

  test("invalid characters, edges and formula starts are fixable errors", () => {
    const r = F.validate({ filename: "=a:b.", ext: "pdf", url: "https://x" });
    eq(r.errors.map((e) => [e.code, e.fixable]), [["chars", true], ["edges", true], ["formula", true]]);
  });

  test("reserved names, ignoring case and anything after the first dot", () => {
    for (const n of ["CON", "con", "Aux.backup", "com1", "LPT9", "nul "]) {
      ok(codes(F.validate({ filename: n, ext: "pdf", url: "" })).includes("reserved"), n);
    }
    for (const n of ["CONTACT", "COM0", "LPT10", "console"]) {
      ok(!codes(F.validate({ filename: n, ext: "pdf", url: "" })).includes("reserved"), n);
    }
  });

  test("length limit counts the extension", () => {
    ok(!codes(F.validate({ filename: "a".repeat(146), ext: "pdf", url: "" })).includes("length"), "146+4");
    ok(codes(F.validate({ filename: "a".repeat(147), ext: "pdf", url: "" })).includes("length"), "147+4");
  });

  test("blocked, invalid and warned extensions", () => {
    eq(codes(F.validate({ filename: "a", ext: "exe", url: "" })), ["ext-blocked"]);
    eq(codes(F.validate({ filename: "a", ext: "p df", url: "" })), ["ext-invalid"]);
    eq(codes(F.validate({ filename: "a", ext: "zip", url: "" })), ["zip"]);
    eq(codes(F.validate({ filename: "a", ext: "auto", url: "" })), ["auto"]);
  });

  test("duplicate, empty, relative, http, notes", () => {
    eq(codes(F.validate({ filename: "a", ext: "pdf", url: "http://x/a.pdf", duplicate: true, notes: ["shortened", "formula"] })),
      ["duplicate", "shortened", "formula-fixed", "http"]);
    eq(codes(F.validate({ filename: " ", ext: "pdf", url: "" })), ["empty"]);
    eq(codes(F.validate({ filename: "a", ext: "pdf", url: "", relative: true })), ["relative"]);
  });

  test("duplicate keys ignore case and include the extension", () => {
    eq(F.duplicateKey("Report", "PDF".toLowerCase()), F.duplicateKey("REPORT", "pdf"));
    ok(F.duplicateKey("Report", "pdf") !== F.duplicateKey("Report", "docx"), "different ext");
  });

  test("fix cleans user text and avoids reserved names", () => {
    eq(F.fix("=a:b.", "pdf"), "_=a b");
    eq(F.fix("CON", "pdf"), "_CON");
    eq(F.fix("x.pdf", "pdf"), "x");
    eq(F.fix("a".repeat(200), "pdf").length, 146);
    ok(!F.validate({ filename: F.fix("..\\..\\x", "pdf"), ext: "pdf", url: "" }).errors.length, "traversal fixed");
  });

  // ── Formats offered side by side ─────────────────────────────────────────

  test("hasUsableLabel", () => {
    const url = "https://x.org/a/CLAD_1_ES.docx";
    ok(F.hasUsableLabel("Report No. 74/26", url), "real text");
    for (const t of ["", "  ", F.PDF_PLACEHOLDER, url, "www.x.org/a", "x".repeat(121)]) ok(!F.hasUsableLabel(t, url), `not ${t.slice(0, 20)}`);
  });

  test("formatGroupKey matches the same file in different formats", () => {
    const pdf = F.formatGroupKey("https://www.oas.org/es/cidh/decisiones/2026/CLAD_2272-23_ES.PDF");
    const docx = F.formatGroupKey("https://www.oas.org/es/cidh/decisiones/2026/CLAD_2272-23_ES.docx");
    ok(pdf && pdf === docx, "same key");
    ok(pdf !== F.formatGroupKey("https://www.oas.org/es/cidh/decisiones/2026/CLAD_812-21_ES.PDF"), "different file");
    ok(F.formatGroupKey("https://x.org/f.pdf?v=1") !== F.formatGroupKey("https://x.org/f.docx?v=2"), "query distinguishes");
    eq(F.formatGroupKey("https://x.org/folder/"), "");
    eq(F.formatGroupKey("not a url"), "");
  });

  // ── Reading saved pages ──────────────────────────────────────────────────

  const fileOf = (bytes) => new File([new Uint8Array(bytes)], "page.html");
  const latin1 = (s) => [...s].map((c) => c.charCodeAt(0));

  test("readHtmlFile honours a declared iso-8859-1 charset", async () => {
    const html = '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" /><p>Martínez</p>';
    const text = await ns.readHtmlFile(fileOf(latin1(html)));
    ok(text.includes("Martínez"), text);
  });

  test("readHtmlFile handles <meta charset>, BOM and the UTF-8 default", async () => {
    const utf8 = (s) => [...new TextEncoder().encode(s)];
    ok((await ns.readHtmlFile(fileOf(latin1('<meta charset="windows-1252">Perú')))).includes("Perú"), "meta charset");
    ok((await ns.readHtmlFile(fileOf([0xEF, 0xBB, 0xBF, ...utf8('<meta charset="iso-8859-1">Perú')]))).includes("Perú"), "BOM wins");
    ok((await ns.readHtmlFile(fileOf(utf8("<p>Perú</p>")))).includes("Perú"), "UTF-8 default");
    ok((await ns.readHtmlFile(fileOf(utf8('<meta charset="bogus-label">Perú')))).includes("Perú"), "unknown label falls back");
  });

  // ── URLs ─────────────────────────────────────────────────────────────────

  test("isRelativeHref", () => {
    for (const h of ["2024/a.pdf", "/en/x.asp", "../a", "//host/x", "a.pdf?x=1"]) ok(ns.isRelativeHref(h), h);
    for (const h of ["", "#top", "https://x", "mailto:a@b", "javascript:alert(1)", "JAVASCRIPT:x", "www.x.org", "file:///c:/x", "data:text/html,x"]) {
      ok(!ns.isRelativeHref(h), `not ${h}`);
    }
  });

  test("resolveUrl against a base", () => {
    const base = "https://www.oas.org/en/iachr/decisions/admissibilities.asp?Year=2024";
    eq(ns.resolveUrl("2024/BRIN_804-19_EN.PDF", base), `${OAS}2024/BRIN_804-19_EN.PDF`);
    eq(ns.resolveUrl("/en/x.pdf", base), "https://www.oas.org/en/x.pdf");
    eq(ns.resolveUrl("//cdn.oas.org/x.pdf", base), "https://cdn.oas.org/x.pdf");
    eq(ns.resolveUrl("https://other.org/y.pdf", base), "https://other.org/y.pdf");
  });

  test("resolveUrl rejects unsafe or unusable input", () => {
    const base = "https://x.org/a/";
    eq(ns.resolveUrl("javascript:alert(1)", base), "");
    eq(ns.resolveUrl("file:///C:/x.pdf", base), "");
    eq(ns.resolveUrl("\\\\host\\share\\x.pdf", base), "");
    ok(!ns.isRelativeHref("\\\\host\\share\\x.pdf"), "UNC path isn't relative");
    eq(ns.resolveUrl("a.pdf", ""), "");
    eq(ns.resolveUrl("a.pdf", "file:///C:/dir/"), "");
    eq(ns.resolveUrl("a.pdf", "not a url"), "");
  });

  test("cleanUrl still rejects relative links (other workflows unchanged)", () => {
    eq(ns.cleanUrl("2024/a.pdf"), "");
  });

  report();
})();
