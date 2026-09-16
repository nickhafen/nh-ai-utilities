# Plan: Batch Download workflow

Status: **implemented on branch `batch-download` (2026-09-16), Phases 0–4.** Drafted 2026-09-16; revised 2026-09-16 with Nick's decisions.

Deviations from the plan made while building:
- Toast UI Editor 3.2.2 is **vendored** (`vendor/toastui/3.2.2/`) instead of loaded with SRI: uicdn.toast.com sends no CORS header, so an SRI-checked load fails, and the npm build on jsDelivr isn't the self-contained bundle.
- The CSP has no `file:` sources: Chrome/Edge already treat `'self'` as covering pages opened from disk (tested).
- The script also marks saved files with the Zone.Identifier stream (Mark of the Web), so Office opens them in Protected View.
- Not done: the optional bookmarklet, retiring `MyApps\Download with URL and Rename Files\` (outside this repo), and paste tests in Edge/Firefox (Chrome only).

## Decisions (settled)

| Topic | Decision |
|---|---|
| Workflow name | **Batch Download** |
| Output folder | **`Downloaded Files`** (next to the script) |
| Extension allowlist | Keep the proposed list as is (below) |
| Order of work | **Phase 0 (site hardening) first** |
| Code loaded at runtime (esm.sh tokenizer, pdf.js, tesseract) | These can't carry integrity hashes. **Accept the risk and document it** in the README and the in-app notice |
| History | Add a **Batch Download card** that reopens the review table, so the user can export the zip again |
| Copies of the script | **One copy is authoritative:** a constant in `js/shared/batch-download-script.js`. No `.ps1` in the repo. (See "Script packaging".) |
| User communication | **Disclose limitations and risks before first use, and explain every failure in plain language**, in both the web app and the script (see "User-facing disclosures and messages") |

## Goal

Add a **Batch Download** workflow to Document Tools. The user adds a document the same way as for the other workflows (pasted rich text, saved `.html`, `.docx`, `.pptx`, `.pdf`). The workflow then:

1. Lists every linked file, with a suggested filename and extension.
2. Lets the user edit filenames and uncheck rows to skip them.
3. Flags filenames Windows won't accept, duplicates, and unsafe file types.
4. Exports a **zip** holding `files.csv`, a fixed PowerShell script, a double-click runner, and a README.
5. The user unzips and runs the script. It downloads each file and saves it under the approved name.

It replaces the standalone tool in `MyApps\Download with URL and Rename Files\`, where the user builds the CSV by hand and the script has no safety checks.

### Why a local script does the downloading

A browser page on `github.io` can't read files from other sites, or rename them, unless those sites allow it. OAS doesn't: a test fetch from the live site failed with "Failed to fetch". Adding a server was rejected (running and securing it isn't worth it, and documents would pass through it). So the site stays browser-only, and downloading happens on the user's machine. The README's "no server, no uploads" promise still holds.

---

## What the repo already has (inspection findings)

### Reusable as-is

| Piece | Where | Notes |
|---|---|---|
| Workflow host ("rail") | `js/tools/document-tools.js` | `WORKFLOWS` array (l.11), a mount div per workflow (l.260–262), `distributeLinks()` (l.342), `clearDocument()` (l.438), History restore hook `handleShow` (l.523). A new workflow plugs into these places. |
| Link list shape | all extractors | `{ visibleText, url }[]`, already deduplicated and cleaned. |
| Link extraction from pastes and HTML | `extractFromPaste()` in `document-tools.js:118` | Uses `DOMParser`, which never runs scripts or loads resources. |
| Paste cleanup | `sanitizeNode()` in `document-tools.js:62` | Rebuilds pasted content as plain text and links only, so it's safe. |
| DOCX / PPTX / PDF extraction | `js/shared/docx.js`, `pptx.js:229`, `pdf.js:80` | |
| URL cleanup | `ns.cleanUrl` in `js/shared/urls.js:62` | **Already rejects anything that isn't `http:`/`https:`.** It also unwraps Google and Outlook Safelinks redirects. |
| Safe rendering | `ns.escapeHtml` (`dom.js:22`), used by `analyzer.js` tables | The new table must follow the same pattern. |
| Checkbox table and CSV export | Extract URLs workflow, `analyzer.js:131–248` | Closest existing UI; copy its structure. |
| Zip creation | JSZip, already loaded; `skill-creator.js:90` has the download pattern | |
| History store and cards | `js/shared/history.js`, `js/tools/history-view.js` | Sessions keyed by `inputType`, routed through `ns.pending*Session` globals. |
| Dev server | `.claude/launch.json` (`py -m http.server 5175`) | |

### Gaps and problems found

1. **Relative links are silently dropped.** `cleanUrl()` calls `new URL(url)` without a base, so `2024/BRIN_804-19_EN.PDF` or `/en/iachr/...` throws an error and the link disappears (`urls.js:76–87`). The OAS decision pages link this way, so a **saved `.html` file would currently yield few or none of the document links.**
   - Pasted text is probably fine: Chromium browsers turn links into full URLs when copying. This still needs a test in Chrome, Edge and Firefox.
2. **PDF links have a placeholder label.** `extractPdfLinks` sets `visibleText` to the literal string `"[Feature unavailable for PDFs]"` (`pdf.js:93`). That must never become a filename.
3. **Bare URLs use the URL as their label.** DOCX pass 2, PPTX pass 2 and paste all call `add(url, url)`, so filename logic must spot "label equals URL" and fall back to the URL's last segment.
4. **Most XML entities stay encoded in DOCX link text.** `docx.js` decodes only `&amp;`, so link text can contain `&quot;`, `&lt;` and similar. Decode these before building a filename.
5. **Deduplication is inconsistent.** `extractFromPaste` dedups case-sensitively and `extractUrls` case-insensitively. This is minor, but the new workflow also needs its own duplicate check on *filenames*.
6. **Pasting a whole page includes navigation links.** A Ctrl+A copy brings in menus, footers and `.asp` pages. The workflow must pre-uncheck rows that aren't documents, or the review step becomes tedious.
7. **The script file can't be fetched when the site is opened from disk.** The README tells users to open `index.html` straight from the folder, and Chrome blocks `fetch("…/download-files.ps1")` there. The script text has to ship inside a JS file.
8. **The site loads code from other servers with no integrity checks.** `index.html` loads:
   - Toast UI from `.../editor/latest/...` (both the CSS and the JS), which is unpinned
   - unpkg (pinned) and cdnjs (pinned), all with **no SRI** (integrity hash)

   Dynamic `import()` pulls from `esm.sh` (`converter-utils.js:12`) and cdnjs (`pdf.js:12`), and the OCR code inserts a script tag from jsdelivr (`ocr.js:15`). The page has **no Content Security Policy.** None of this has mattered much so far, because a compromised CDN could only affect a browser tab. Once the site hands out a script that people run, a compromised CDN could affect their computers.
9. **History would open a batch session in the wrong workflow.** `history-view.js` treats any `inputType` it doesn't recognize as an AI Indicators session (l.138–141, l.60–66). Batch sessions need their own branch *before* that fallback.
10. **Failed History saves are silent.** When localStorage is full, `ns.history.save()` drops half the entries and retries; if that also fails it gives up with no message (`history.js:14–21`). That conflicts with the "explain every failure" requirement.
11. **The old script's data handling is fine but it has no guards** (`download_pdfs.ps1` in the separate `MyApps\Download with URL and Rename Files\` folder, for reference only; nothing from it is copied or needed, because the new script is written from scratch in this repo). It keeps data out of code (good), but:
    - doesn't check URL schemes (WebClient accepts `file://` and UNC paths)
    - doesn't check that files stay inside the output folder
    - doesn't restrict extensions
    - silently overwrites files
    - reads the CSV with Windows PowerShell 5.1's default encoding, which garbles accented Spanish/Portuguese filenames (OAS)
    - leaves partial files behind when a download fails partway
    - only prints raw .NET exception text when something fails

---

## Architecture

```
Document rail ──links──▶ Batch Download workflow (new: js/tools/batch-download.js)
                              │  up-front notice (limitations & risks)
                              │  review table: ☑ | filename | .ext | URL | status
                              │  base-URL field (for relative links)
                              ▼
                        Export zip (JSZip) ──▶ History card (reopens this table)
                          ├─ files.csv              ← the ONLY user data (UTF-8 with BOM)
                          ├─ download-files.ps1     ← fixed text, never built from user data
                          ├─ Run Download.cmd       ← fixed text
                          └─ README.txt             ← fixed text: limitations, warnings, hash check
```

### Core rule: the script is fixed, and data goes only in the CSV

The script text is a constant. **No template substitution, ever.** User data reaches the user's machine only through `files.csv`, which the script reads as data.

### Script packaging (one authoritative copy)

- `js/shared/batch-download-script.js` holds three `String.raw` constants: `SCRIPT_PS1`, `RUNNER_CMD` and `README_TXT`. **This file is the only copy.** There's no `.ps1` in the repo that could drift out of sync.
- **Format of the files written into the zip:**
  - Line endings are converted to **CRLF**, because `.cmd` files can misbehave with LF-only endings.
  - The script is **ASCII-only**, because PowerShell 5.1 misreads UTF-8 files that lack a byte-order mark.
- **Published hash.** The README lists the SHA-256 of the exact `download-files.ps1` bytes that go into the zip.
  - A dev-only page, `tests/script-hash.html`, computes that value from the constant.
  - Whenever the script changes, re-run that page and update the README (add this to the Phase 4 checklist and to a comment at the top of the constant).
- The workflow shows a **"View script"** panel with the exact text, so users can read what they'll run. The UI does **not** show a hash: a compromised page could fake it, so the README on GitHub is the reference.
- For testing, get the script by exporting a bundle. That also tests the real packaging path.

### Files touched

| File | Change |
|---|---|
| `js/tools/batch-download.js` | **new**: `ns.mountBatchDownloadWorkflow(root)` returning `{ setLinks, reset, restoreSession }` |
| `js/shared/batch-download-script.js` | **new**: script, runner and README constants (only copy) |
| `js/shared/filenames.js` | **new**: suggest/sanitize/validate helpers (pure functions, easy to test) |
| `js/shared/urls.js` | add `ns.resolveUrl(href, base)`; leave `cleanUrl` behavior unchanged for the other workflows |
| `js/shared/history.js` | make `save()` report failure (return `false`, or fire an event) so callers can tell the user |
| `js/tools/document-tools.js` | register the workflow, add the mount div, include it in `distributeLinks`/`clearDocument`, pass unresolved relative links plus a detected base URL, route `ns.pendingBatchSession` in `handleShow` |
| `js/tools/history-view.js` | `batch-download` branch in `sessionSummary`, `sessionCardHtml` and the click handler, before the fallback; mention batch downloads in the empty-state hint |
| `index.html` | add script tags; Phase 0 hardening |
| `styles.css` | editable-cell, validation-state, notice and badge styles (`session-type-batch`) |
| `README.md` | workflow docs, limitations, security/risk section, script hash |

---

## User-facing disclosures and messages

The rule: **the user learns about limitations before relying on the tool, and every failure explains what happened and what to try next.** No step fails silently, and no raw exception text is the only message.

### Before first use (in the web app)

A notice panel at the top of the Batch Download workflow. It's expanded the first time and can be collapsed after that (the collapsed state is saved in localStorage; if storage isn't available, it's always expanded). It covers:

- **How it works:** "This page builds a download list; a small Windows script on your computer does the downloading. Nothing is uploaded."
- **Trust:** "You'll run a PowerShell script from this site. Read it with *View script* first, and check its fingerprint against the one on GitHub (instructions in the bundle's README)."
- **Windows only**, and it expects Windows' "Open File – Security Warning" when the runner is double-clicked.
- **What it can't do:**
  - Files behind a login, paywall or CAPTCHA fail. The script doesn't use your browser's sign-in.
  - Links added by JavaScript, or hidden behind "load more" or pagination, may be missing. Paste the page instead of saving it, or scroll everything into view first.
  - Saved `.html` pages may need the Base URL filled in.
  - Link text in PDFs isn't available, so names come from the URL.
  - Only these file types can be downloaded: *(the allowlist)*.
- **Risk note on third-party code:** "This site loads some libraries from public CDNs at runtime. Pinned libraries are integrity-checked; a few (tokenizer, PDF reader, OCR) can't be. See the README's Security section."
- **You are responsible** for having the right to download the linked files.

The bundle's `README.txt` repeats the same limitations, and the GitHub README gets a matching **Limitations & risks** section.

### Web app failure and warning messages

Each message says what happened, why (if known), and what to do next. They're shown next to the affected row, or in the workflow's alert area (`role="alert"`) for problems that affect the whole workflow.

| Situation | Message (draft) |
|---|---|
| Document has no links | "No links found in this document. If you saved a web page, try copying the page (Ctrl+A, Ctrl+C) and pasting it instead." |
| Links found, but none look like downloadable files | "Found N links, but none point to a supported file type. Switch *Show* to *All links* to review them." |
| Relative links and no base URL | "N links are relative (e.g. `2024/report.pdf`) and need the page's address. Enter it in *Base URL*." |
| Base URL invalid | "That isn't a valid web address. It should start with https://." |
| Row: characters not allowed | "Windows doesn't allow these characters in filenames: `\ / : * ? \" < > |`." (Offer "Fix automatically".) |
| Row: reserved name | "`CON` is reserved by Windows. Choose a different name." |
| Row: duplicate | "Another checked row uses this name. Filenames must be unique (capital letters don't count as a difference)." |
| Row: file type blocked | "`.exe` files can't be downloaded with this tool, for safety. Uncheck this row." |
| Row: unknown type (warning) | "No file type in the URL. The script will work out the type after downloading, and skips the file if it isn't an allowed type." |
| Row: name shortened (warning) | "Name shortened to 150 characters to stay within Windows path limits." |
| Row: starts with `= + - @` (warning) | "Name starts with a character spreadsheets treat as a formula; a leading `_` was added." |
| Row: `http:` (warning) | "This link isn't encrypted (http). It will still download." |
| Export blocked | "Fix the N highlighted rows (or uncheck them) before downloading." The button's tooltip says the same. |
| Nothing checked | "Check at least one row to build a download bundle." |
| JSZip didn't load | "The zip builder didn't load. Check your connection and refresh the page." |
| Zip generation failed | "Couldn't create the download bundle (*reason*). Try again; if it keeps failing, try fewer rows or another browser." |
| History save failed (storage full or blocked) | "Your bundle downloaded, but this session couldn't be saved to History (browser storage is full or blocked). Clear old History entries to make room." |
| History entry can't be restored (corrupt or from an older version) | "This History entry couldn't be reopened. It may be from an older version of the tool." Leave the card in place so the user can delete it. |
| Extraction from the document failed | Keep the existing rail messages (`document-tools.js` `railFail`). The workflow shows the empty state with the rail's error. |

### Script failure messages (console, plus `download-log.csv`)

The script prints one line per row: `[OK]`, `[SKIPPED]` or `[FAILED]`, then the filename and a plain-language reason. Raw error details go only in the log's `Detail` column. At the end it prints a summary with counts, where the log is, and hints for the most common failures.

| Situation | Message (draft) |
|---|---|
| `files.csv` missing | "Can't find files.csv next to this script. Unzip the whole bundle into one folder and run again." (exit, pause) |
| CSV missing required columns or empty | "files.csv isn't in the expected format (URL, Filename, Extension). Re-export it from the Batch Download page." |
| Can't create the output folder | "Couldn't create the 'Downloaded Files' folder here (*reason*). Move the bundle to a folder you can write to (e.g. Documents) and run again." |
| URL isn't http/https, or is a network path | "Skipped: only web links (http/https) are allowed." |
| Bad filename or reserved name | "Skipped: the filename isn't allowed by Windows. Fix it on the Batch Download page and re-export." |
| Path escapes the folder | "Skipped: the filename tries to save outside the 'Downloaded Files' folder." |
| Path too long | "Skipped: the full path is too long for Windows. Move the bundle to a shorter folder path (e.g. C:\Downloads) or shorten the name." |
| Extension not allowed | "Skipped: .xyz files aren't allowed." |
| File already exists | "Saved as 'Name (2).pdf' because 'Name.pdf' already exists." (OK line with a note.) |
| HTTP 401/403 | "Failed: the site refused access (login or permission required). Download this one manually in your browser." |
| HTTP 404 | "Failed: the file wasn't found at that address (404). The link may be outdated." |
| HTTP 429/5xx | "Failed: the site is busy or had an error (*code*). Try again later." |
| Timeout | "Failed: the site took too long to respond." |
| DNS or connection failure | "Failed: couldn't reach *host*. Check your internet connection or VPN." |
| TLS/certificate error | "Failed: couldn't make a secure connection to *host*." |
| Web page received instead of a document | "Failed: the site sent a web page instead of the file (often a login or error page). Open the link in your browser to check." |
| `auto` type detected as something not allowed | "Failed: the downloaded file is a type that isn't allowed (*detected*). It was deleted." |
| Can't write or move the file (locked, antivirus, OneDrive) | "Failed: couldn't save the file (*reason*). Close any program using it, or check that OneDrive or antivirus isn't blocking the folder." |
| All rows failed | The summary adds: "Nothing was downloaded. The most common causes are no internet connection, a VPN or proxy, or links that need a login." |
| Unexpected error | "Something unexpected went wrong: *message*. The details are in download-log.csv." The script continues with the next row where it safely can. |

`Run Download.cmd` ends with `pause`, so the window stays open and the user can read the messages.

---

## Workflow UI

**Accepted inputs:** `docx`, `html`, `pdf`, `pptx`, `paste` (same as Extract URLs). Rail entry: label **Batch Download**, sub-label "Review names, get a download script".

**Layout, top to bottom:** disclosure notice → toolbar → table → alert area.

**Toolbar:**
- **Base URL** field. It's pre-filled from the saved page's `<base href>` or Chrome's `<!-- saved from url=(NNNN)… -->` comment when present. Editing it re-resolves relative links.
- **Show:** Documents only (default) / All links.
- **Name from:** Link text (default) / URL filename. This applies to all rows but doesn't overwrite rows the user has edited.
- Counts: `N selected · M problems`.
- **Download bundle (.zip)**. It's disabled while any *checked* row has an error, with the reason shown.
- **View script**.

**Table columns:** ☑ include · Filename (editable) · Ext (editable, from a short list plus "auto") · URL (link that opens in a new tab) · Status.

**Row defaults:**
- **Checked** if the extension is on the allowlist.
- **Unchecked** for web pages (`.htm/.html/.asp/.aspx/.php/.jsp`, or no extension on a path that looks like a page), for `mailto:`, and for same-page anchors.
- **Unchecked with "unknown type"** if there's no extension and nothing in the query string suggests one.

**Validation** runs on every input event, and messages update live (see the tables above). Errors block the export only for checked rows.

### History card

- **When it's saved:** the first time a zip is exported for the current document, save a session. After that, **update** it on each re-export, and save edits made after an export automatically (debounced to about 1 second).
- **Session shape:**

  ```js
  { id, timestamp, inputType: "batch-download", sourceLabel, baseUrl,
    show, nameFrom, rows: [{ url, rawHref, visibleText, filename, ext, checked, edited }],
    exportCount, lastExportedAt, version: 1 }
  ```

  Validation results aren't stored; they're recalculated when the session is restored.
- **Card:** badge `BATCH`; summary like "12 files selected of 30 links · exported 2×"; tooltip "Click to reopen this download list".
- **Restoring:** the card click sets `ns.pendingBatchSession` and navigates to `#document-tools`. `handleShow` selects Batch Download and calls `restoreSession(s)`. The rail shows "Restored from History: *label*", because the original document isn't stored. The table can be edited and exported again.
- A `version` value lets future format changes show the "couldn't be reopened" message instead of breaking.
- Session size: rows are small, but the existing 30-entry cap applies. A failed save shows the History message above.

---

## Filename rules (`js/shared/filenames.js`)

### Suggested name
1. Start from `visibleText`, unless:
   - it's empty,
   - it equals the URL,
   - it's the PDF placeholder,
   - or it's longer than 120 characters (a whole paragraph was linked).

   In any of those cases, use the URL's last path segment instead, decoded (`%20` → space) and without its extension.
2. Decode HTML/XML entities, then collapse whitespace.
3. Replace `/` and `\` with `-`. For example, `Report No. 238/24` becomes `Report No. 238-24`.
4. Strip the other characters Windows doesn't allow (`: * ? " < > |`) and control characters, replacing each with a space; then collapse spaces.
5. Trim trailing dots and spaces.
6. If the name starts with `= + - @`, add a leading `_`.
7. If the name ends up empty, use `file-<n>`.

### Extension
- Take it from the URL path's last segment and lowercase it (`.PDF` → `.pdf`).
- If the path has none, look through the query parameters for a value like `something.pdf`.
- Otherwise use `auto`, and the script detects the type from the file itself.
- If the suggested name already ends with the same extension, don't add it twice.

### Allowlist (decided: keep as is)
- **Allowed:** `pdf doc docx rtf odt txt md csv xls xlsx ods ppt pptx odp jpg jpeg png gif tif tiff webp mp3 mp4 m4a wav zip`
- `zip` is allowed with a warning ("zip files can contain anything; open with care").
- Everything else is an **error**.
- **The same list is enforced again inside the script.**

### Validation
- **Reserved device names**, ignoring case and anything after the first dot: `CON PRN AUX NUL COM1–9 LPT1–9`.
- **Length:** the name plus extension must be 150 characters or fewer. The script also checks the full path length.
- **Duplicates:** compare `name + ext`, ignoring case, across checked rows only.

---

## Script spec (`download-files.ps1`)

Target: Windows PowerShell 5.1, with no modules and ASCII-only source. The script should stay short and readable, since users are asked to trust it. Messages follow the script table above.

1. **Locations:** the CSV is `$PSScriptRoot\files.csv`; files go to `$PSScriptRoot\Downloaded Files\`, created if missing.
2. **CSV:** `Import-Csv -Encoding UTF8`, with columns `URL,Filename,Extension`. The web app writes the file as UTF-8 **with BOM**, and quotes every field. Check the columns before processing any row.
3. **Checks on each row, repeating the web app's rules.** A user might hand-edit the CSV, so the script trusts nothing. A row is skipped with a reason if:
   - The URL doesn't parse as an absolute `[Uri]` with scheme `http` or `https`. This blocks `file://`, UNC paths (`\\host\share`) and `ftp`.
   - After the same cleanup as the web app, the filename is empty or reserved.
   - The extension is not on the allowlist, and isn't `auto`.
   - The final path doesn't stay inside the output folder. Check with `[IO.Path]::GetFullPath` plus a prefix comparison that ignores case, so `..` and drive letters fail.
   - The full path is longer than 250 characters.
4. **No overwrites.** If the target exists, add ` (2)`, ` (3)`, and so on, and say so in the output.
5. **Download to a temp name first**, then move it into place (no partial files; the temp file is deleted if anything fails).
   - Keep `WebClient`, and enable TLS 1.2 **in addition to** the defaults (`-bor`).
   - Map `WebException` status and HTTP codes to the friendly messages.
   - For `auto` rows, work out the type from the first bytes of the file: `%PDF` → pdf, `PK` → zip-based (use `Content-Type` to choose docx/xlsx/pptx, else zip), `D0 CF 11 E0` → legacy doc/xls/ppt. Then use the response `Content-Type`. Discard the file if the result isn't on the allowlist.
   - **Catch HTML error pages.** If the extension is a document type but the file starts with `<!DOCTYPE` or `<html`, discard it and report it.
6. **Summary:** counts of saved, skipped and failed files, plus hints. Write `download-log.csv` (UTF-8 BOM) with columns `Row, URL, SavedAs, Status, Reason, Detail`, then open the output folder (only if something was saved).
7. **No other side effects:** no registry or profile changes, nothing runs from what was downloaded, no elevation.

`Run Download.cmd` (CRLF):

```bat
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-files.ps1"
pause
```

`README.txt` covers:
- How to run.
- The Windows "Open File – Security Warning" to expect, and why.
- The limitations list.
- How to check the script's fingerprint (`Get-FileHash download-files.ps1`) against the SHA-256 in the GitHub README.
- Where the log is.
- Windows only.

---

## Security measures (summary)

| Risk | Mitigation | Where |
|---|---|---|
| Hostile link text turned into code | Script is a fixed constant; data goes only in the CSV | architecture |
| `file://` or UNC URLs leaking Windows password hashes | Only `http`/`https` allowed | `cleanUrl` (exists) + script |
| Files saved outside the folder (`..`, absolute paths) | Filename cleanup + full-path prefix check | web app + script |
| Downloading executables | Extension allowlist + file-type detection for `auto` | web app + script |
| Silent overwrites | Unique-name suffix; duplicate check in the UI | both |
| Spreadsheet formula injection in `files.csv` | Filenames starting with `= + - @` get a leading `_` | web app |
| Script injected into the review table or History cards (XSS) | `escapeHtml` for rendering; input `value` set as a property, not built from HTML | web app |
| Compromised CDN altering the bundle | Phase 0: pin, add SRI, add CSP. Code loaded at runtime is **accepted and documented** | `index.html`, README |
| Repo takeover | GitHub 2FA; consider branch protection on `main` | GitHub settings (owner) |
| Users trained to click through warnings | Up-front notice; short, readable script; "View script"; published hash | UI, docs |

Out of scope: code-signing the script with Authenticode. That needs a paid certificate; revisit if this gets wide use.

---

## Phases

### Phase 0 — Harden the site's third-party code (do first)

1. **Pin Toast UI.** Replace both `.../editor/latest/...` URLs with a specific version. Confirm the current version at build time, and check that SKILL Creator still works with it.
2. **Add SRI.** Add `integrity="sha384-…"` and `crossorigin="anonymous"` to every `<script>` and `<link>` in `index.html` that loads from a CDN (JSZip, mammoth, turndown, readability, Toast UI JS and CSS). Compute the hashes from the exact pinned files.
3. **Add a CSP `<meta>` tag.** Starting point (adjust while testing):
   - `default-src 'self'`
   - `script-src 'self' cdnjs.cloudflare.com unpkg.com uicdn.toast.com esm.sh cdn.jsdelivr.net 'wasm-unsafe-eval'`
   - `worker-src 'self' blob: cdnjs.cloudflare.com cdn.jsdelivr.net`
   - `style-src 'self' 'unsafe-inline' uicdn.toast.com`
   - `img-src 'self' data: blob: https:`
   - `font-src 'self' data: uicdn.toast.com`
   - `connect-src 'self' https: http:` (the AI Indicators reachability check fetches arbitrary URLs; tesseract fetches language data)
   - `object-src 'none'`
   - `base-uri 'none'`
   - `form-action 'none'`
4. **Test every tool** with the CSP on, both served over HTTP and opened straight from disk:
   - Convert DOCX, PPTX, PDF, image (OCR) and HTML
   - Extract URLs; AI Indicators
   - SKILL Creator; Curriculum Planner; History

   Chrome may not let `'self'` cover pages opened from disk. If so, add `file:` to `script-src` and `worker-src`, and note why in a comment.
5. **Document the accepted risk.** Add a **Security & third-party code** section to the README. It should list each CDN, which are integrity-checked, and which are loaded at runtime without a check (esm.sh tokenizer, pdf.js plus its worker, tesseract plus its workers and language data). It should say this is an accepted risk and why. Add a one-line pointer in the app footer.
6. **Commit Phase 0 on its own**, before any Batch Download work.

### Phase 1 — Shared helpers

- `filenames.js` (suggest, sanitize, validate, extension detection, allowlist).
- `urls.js`: `resolveUrl`.
- Rail: keep relative hrefs from HTML and paste input, and detect the base URL. Other workflows keep receiving only full URLs.
- `history.js`: `save()` reports failure (the existing callers ignore the return value, so nothing breaks).
- Tests: `tests/filenames.html`, a small page that runs checks in the browser (no framework, matching the repo's no-build style).

### Phase 2 — Script bundle

- `batch-download-script.js` (the three constants, CRLF conversion when zipping) and `tests/script-hash.html`.
- Hostile-CSV fixture `tests/fixtures/hostile.csv`, covering:
  - UNC paths, `file://` and `ftp://` URLs
  - `..\..\x`, `C:\x` and reserved names in filenames
  - blocked extensions (`.exe`, `.lnk`)
  - duplicates and an overlong name
  - non-ASCII names
  - a URL that returns an HTML page instead of a document
  - a 404 URL and an unreachable host

  Run the exported script against it and confirm every row gets the intended `[SKIPPED]`/`[FAILED]` message and a log entry.
- Failure-path checks:
  - missing `files.csv`
  - wrong columns
  - read-only output folder
  - a very deep folder path (OneDrive)

### Phase 3 — Workflow UI and History

- `batch-download.js` (notice, toolbar, table, live validation, alert area, zip export, "View script"), rail registration, styles.
- History: session save/update, the card in `history-view.js`, restoring through `handleShow`, the save-failure message, the "couldn't be reopened" path.
- Manual tests in the preview server:
  - (a) Ctrl+A paste of an OAS decisions page in Chrome, Edge and Firefox
  - (b) the same page saved as "HTML only" and as "Webpage, Complete"
  - (c) a DOCX with linked documents
  - (d) a PDF with link annotations
  - (e) every message in the web app messages table appears where expected
- End-to-end: export → unzip with Explorer → double-click the runner → files named correctly (including the `.docx` rows that motivated this) → close and reopen from History → edit → re-export.

**Reference test inputs** (the real case that motivated this; listed here so the plan doesn't depend on the old folder):
- Page with relative document links: `https://www.oas.org/en/iachr/decisions/admissibilities.asp`
- A PDF with an uppercase extension: `https://www.oas.org/en/iachr/decisions/2024/BRIN_804-19_EN.PDF` (link text "Report No. 238/24")
- A DOCX: `https://www.oas.org/en/iachr/decisions/2024/BRIN_1179-15_EN.docx` (link text "Report No. 119/24")
- Expected names: `Report No. 238-24.pdf`, `Report No. 119-24.docx`

### Phase 4 — Docs and cleanup

- README:
  - Batch Download section
  - **Limitations & risks** section (same list as the in-app notice)
  - script SHA-256
  - update the roadmap
- Checklist comment on the script constant: "changed the script → re-run `tests/script-hash.html` → update the README hash."
- Optional: a bookmarklet that copies the current page's document links to the clipboard.
- Retire `MyApps\Download with URL and Rename Files\`, or replace its README with a pointer to the new workflow.

---

## Known limitations (shown in the notice, the bundle README and the GitHub README)

- **Windows only.**
- **No sign-in:** files behind a login, paywall or CAPTCHA fail, and the script says so.
- **Missing links:** links added by JavaScript, or hidden behind "load more" or pagination, may not be captured.
- **Saved pages** may need a Base URL.
- **PDF links** have no link text, so their names come from the URL.
- **Links written without `http`** (e.g., `oas.org/...`) aren't detected; `www.` links are.
- **Allowed file types only**; others are blocked for safety.
- **Code loaded at runtime** (tokenizer, PDF reader, OCR) isn't integrity-checked; this is an accepted, documented risk.

## Open questions

None blocking. Items to confirm while building:
- **Toast UI version to pin**, checked against SKILL Creator.
- **The final CSP**, adjusted to whatever each tool actually needs.
- **Whether Chrome's clipboard HTML always contains full URLs** in all three browsers; this decides how much the Base URL field matters for pastes.
