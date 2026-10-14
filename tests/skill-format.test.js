(function () {
  const S = window.AiUtilities.skillFormat;
  const levels = (r) => r.notes.map((n) => n.level);

  // ── Names ────────────────────────────────────────────────────────────────

  test("toSkillName: spaces, case, punctuation, accents", () => {
    eq(S.toSkillName("My Skill (v2)"), "my-skill-v2");
    eq(S.toSkillName("  Résumé Review!! "), "resume-review");
    eq(S.toSkillName("a--b"), "a-b");
    eq(S.toSkillName("x".repeat(70)).length, 64);
  });

  test("validateName: spec rules", () => {
    eq(S.validateName("good-name-2"), null);
    ok(S.validateName(""), "empty");
    ok(S.validateName("Bad"), "uppercase");
    ok(S.validateName("-lead"), "leading hyphen");
    ok(S.validateName("a--b"), "double hyphen");
    ok(S.validateName("x".repeat(65)), "too long");
  });

  test("platformWarnings: reserved words and tags", () => {
    eq(S.platformWarnings("research-helper", "Use for papers").length, 0);
    eq(S.platformWarnings("claude-helper", "ok").length, 1);
    eq(S.platformWarnings("x", "Use when <b>asked</b>").length, 1);
  });

  // ── Markdown / text ──────────────────────────────────────────────────────

  test("md with standard frontmatter", () => {
    const r = S.readTextFile("---\nname: summarize-paper\ndescription: Use when summarizing\nlicense: MIT\n---\n\n# Steps\n\nDo it.\n", "SKILL.md");
    eq(r.name, "summarize-paper");
    eq(r.description, "Use when summarizing");
    eq(r.extraFields, [{ name: "license", kind: "text", value: "MIT", subFields: [] }]);
    eq(r.body, "# Steps\n\nDo it.");
    eq(levels(r), ["ok"]);
  });

  test("CRLF, BOM, quoted values, colon in description", () => {
    const r = S.readTextFile("﻿---\r\nname: 'x'\r\ndescription: \"Use when: the user asks\"\r\n---\r\nBody\r\n", "a.md");
    eq(r.name, "x");
    eq(r.description, "Use when: the user asks");
    eq(r.body, "Body");
  });

  test("folded and literal block scalars, wrapped plain value", () => {
    const r = S.readTextFile("---\nname: x\ndescription: >\n  Line one\n  line two\ncompatibility: Needs\n  python\nnotes: |\n  a\n  b\n---\n", "a.md");
    eq(r.description, "Line one line two");
    eq(r.extraFields[0].value, "Needs python");
    eq(r.extraFields[1].value, "a\nb");
  });

  test("nested metadata group and lists", () => {
    const r = S.readTextFile("---\nname: x\ndescription: d\nmetadata:\n  author: Nick\n  version: \"1.0\"\nallowed-tools:\n  - Read\n  - Grep\ntags: [a, b]\n---\n", "a.md");
    eq(r.extraFields[0], { name: "metadata", kind: "group", value: "", subFields: [{ name: "author", value: "Nick" }, { name: "version", value: "1.0" }] });
    eq(r.extraFields[1].value, "Read, Grep");
    eq(r.extraFields[2].value, "a, b");
    ok(r.notes.some((n) => n.level === "warn" && /allowed-tools/.test(n.text)), "list note");
  });

  test("invalid name gets renamed", () => {
    const r = S.readTextFile("---\nname: My Research Skill\ndescription: d\n---\nBody", "a.md");
    eq(r.name, "my-research-skill");
    ok(r.notes.some((n) => n.level === "fixed" && /Renamed/.test(n.text)), "rename note");
  });

  test("txt without delimiters: name/description lines at top", () => {
    const r = S.readTextFile("Name: Contract Review\nDescription: Use when reviewing contracts\n\nRead the contract.\n", "notes.txt");
    eq(r.name, "contract-review");
    eq(r.description, "Use when reviewing contracts");
    eq(r.body, "Read the contract.");
  });

  test("body opening with an unknown key stays in the body", () => {
    const r = S.readTextFile("Note: read carefully\n\nMore text", "Brief Helper.txt");
    eq(r.body, "Note: read carefully\n\nMore text");
    eq(r.name, "brief-helper");
    eq(r.description, "");
  });

  test("no frontmatter: name from first heading, else file name", () => {
    eq(S.readTextFile("# Draft **Memo** Writer\n\nSteps", "SKILL.md").name, "draft-memo-writer");
    eq(S.readTextFile("Steps only", "Cite Checker.md").name, "cite-checker");
    eq(S.readTextFile("Steps only", "SKILL.md").name, "");
  });

  test("a leading horizontal rule with no closing --- is body", () => {
    const r = S.readTextFile("---\n\nJust text", "a.md");
    eq(r.body, "---\n\nJust text");
  });

  // ── Word (Mammoth HTML) ──────────────────────────────────────────────────

  test("docx: frontmatter paragraphs, smart quotes, em-dash delimiters", () => {
    const html = "<p>—</p><p>name: Memo Writer</p><p>description: “Use when drafting memos”</p><p>—</p><p></p><h2>Steps</h2><ul><li>Outline</li></ul>";
    const r = S.readDocxHtml(html, "x.docx");
    eq(r.name, "memo-writer");
    eq(r.description, "Use when drafting memos");
    eq(r.body, "## Steps\n\n-   Outline");
  });

  test("docx: no delimiters, blank paragraph between keys", () => {
    const html = "<p>name: memo-writer</p><p></p><p>description: Use for memos</p><p></p><p>Write <strong>clearly</strong>.</p>";
    const r = S.readDocxHtml(html, "x.docx");
    eq(r.name, "memo-writer");
    eq(r.description, "Use for memos");
    eq(r.body, "Write **clearly**.");
  });

  test("docx: Markdown typed into Word is used as-is", () => {
    const html = "<p>---</p><p>name: typed</p><p>description: d</p><p>---</p><p></p><p>## Steps</p><p></p><p>- one</p><p>- two</p>";
    const r = S.readDocxHtml(html, "x.docx");
    eq(r.name, "typed");
    eq(r.body, "## Steps\n\n- one\n- two");
    ok(/typed as plain text/.test(r.notes[0].text), "typed-markdown note");
  });

  test("docx: soft line breaks inside one paragraph", () => {
    const r = S.readDocxHtml("<p>name: a<br>description: b</p><p>Body</p>", "x.docx");
    eq(r.name, "a");
    eq(r.description, "b");
    eq(r.body, "Body");
  });

  test("importFile rejects other types", async () => {
    let msg = "";
    try { await S.importFile(new File(["x"], "a.pdf")); } catch (e) { msg = e.message; }
    ok(/\.docx, \.md, or \.txt/.test(msg), "message");
    try { await S.importFile(new File(["x"], "a.doc")); } catch (e) { msg = e.message; }
    ok(/save as \.docx/.test(msg), ".doc message");
  });

  test("importFile reads a .md File", async () => {
    const r = await S.importFile(new File(["---\nname: a\ndescription: b\n---\nBody"], "SKILL.md"));
    eq([r.name, r.description, r.body], ["a", "b", "Body"]);
  });

  report();
})();
