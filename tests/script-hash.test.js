(async function () {
  const B = window.AiUtilities.batchDownloadBundle;

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  const scriptBytes = B.scriptBytes();
  document.getElementById("hash").textContent = await sha256Hex(scriptBytes);

  const fixed = { "download-files.ps1": B.SCRIPT_PS1, "Run Download.cmd": B.RUNNER_CMD, "README.txt": B.README_TXT };

  for (const [name, text] of Object.entries(fixed)) {
    test(`${name} is printable ASCII`, () => {
      const bad = [...text].filter((c) => {
        const code = c.charCodeAt(0);
        return code > 126 || (code < 32 && c !== "\n");
      });
      eq(bad.map((c) => c.charCodeAt(0)), []);
    });
    test(`${name} has no carriage returns in the source (CRLF is added when zipping)`, () => {
      ok(!text.includes("\r"), "no \\r");
    });
  }

  test("script contains no template-literal markers", () => {
    ok(!B.SCRIPT_PS1.includes("${"), "no ${");
  });

  test("bundle files are CRLF and fixed", () => {
    const files = B.bundleFiles([{ url: "https://x.org/a.pdf", filename: "A", ext: "pdf" }]);
    eq(files.map((f) => f.name), ["files.csv", "download-files.ps1", "Run Download.cmd", "README.txt"]);
    for (const f of files) ok(!/[^\r]\n/.test(f.content), `${f.name} uses CRLF only`);
    eq(files[1].content, scriptBytes);
  });

  test("files.csv: BOM, header, every field quoted, quotes doubled", () => {
    const csv = B.buildCsv([
      { url: "https://x.org/a.pdf", filename: 'He said "hi", ok', ext: "pdf" },
      { url: "https://x.org/b", filename: "Perú", ext: "auto" },
    ]);
    eq(csv, '﻿"URL","Filename","Extension"\r\n' +
      '"https://x.org/a.pdf","He said ""hi"", ok","pdf"\r\n' +
      '"https://x.org/b","Perú","auto"\r\n');
  });

  test("files.csv neutralizes newlines by quoting", () => {
    const csv = B.buildCsv([{ url: "https://x.org/a.pdf", filename: "a\r\nb", ext: "pdf" }]);
    ok(csv.includes('"a\r\nb"'), "quoted");
  });

  test("runner calls the script by its folder-relative path", () => {
    ok(B.RUNNER_CMD.includes('-File "%~dp0download-files.ps1"'), "runner path");
    ok(/\npause\n$/.test(B.RUNNER_CMD), "ends with pause");
  });

  report();
})();
