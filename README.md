# AI Utilities

Browser-based tools for AI-assisted academic and professional work. No sign-in, no server, no uploads — everything runs locally in your browser.

## Tools

### Document Tools

Add a document once in the persistent document panel — a file (`.docx`, `.pptx`, `.pdf`, `.html`, or a screenshot) or pasted text — then run any workflow against it without re-adding it. The panel tracks the current document across workflow switches, and each workflow lists which inputs it accepts via format chips (e.g. Convert to Markdown accepts every file type; the two link workflows accept `.docx`, `.html`, `.pdf`, `.pptx`, or pasted text — not screenshots).

**Convert to Markdown** — convert Word documents, PowerPoint decks, PDFs, screenshots, and saved web pages to Markdown before sharing with an AI tool. Everything runs locally in the browser — no content leaves your device.

**Supported inputs:**
- `.docx` — Word documents
- `.pptx` — PowerPoint presentations
- `.pdf` — PDFs with a text layer (scanned/image-only PDFs are not yet supported)
- `.png` / `.jpg` / `.jpeg` / `.webp` — screenshots, converted via OCR
- `.html` / `.htm` — web pages saved via "Save Page As → Webpage, HTML Only"

**DOCX conversion:**
- Converts to Markdown using semantic HTML as an intermediate representation
- Optional removal of inline formatting, headers and footers, page numbers, images, comments, and excess whitespace
- Compact Markdown footnotes without return-link overhead
- Preserved hyperlink destinations
- Before/after token comparison: DOCX "before" count reflects raw XML across all document parts — the actual data an AI tool processes when a DOCX is uploaded directly
- Collapsible breakdown showing what's driving token cost in both the DOCX input (body, styles, footnotes, headers/footers, numbering, settings) and the Markdown output (plain text vs. formatting syntax)

**PowerPoint conversion:**
- Same architectural pattern as DOCX: the "before" count sums the raw XML parts inside the .pptx archive (slides, layouts, masters, theme, speaker notes, presentation settings)
- Per-slide Markdown output: slide titles as headings, body placeholders as bullets, tables as Markdown tables, chart titles/series/cached data when available
- Removal toggles (checked = removed, matching the DOCX panel) for speaker notes, hidden slides, slide numbers/footers, master/layout placeholder text, and embedded object data — toggling live-recalculates both the baseline and the Markdown output
- Collapsible breakdown of the PPTX input by XML category and the Markdown output by plain text vs. formatting

**PDF conversion:**
- Text extraction with pdfjs-dist (Mozilla PDF.js) — text-layer only, no OCR yet
- "Before" baseline is the naive per-page text dump (repeated headers/footers, page numbers, and broken line wraps left in) — unlike the DOCX/PPTX baselines, this is *not* a stand-in for the raw file an AI platform would actually ingest (many platforms rasterize PDF pages to images or run their own extraction); it only measures this tool's own extracted text before vs. after cleanup
- Markdown conversion applies best-effort heuristics: headings from font-size deltas, wrapped-line rejoining, bullet/numbered list detection, conservative table reconstruction, and stripping of repeated headers/footers and page numbers
- On documents with little repeated header/footer chrome to strip, Markdown's own syntax (headings, list markers, table formatting) can outweigh the savings, so the token count can increase rather than decrease

**Screenshot conversion (OCR):**
- Text recognized locally with tesseract.js; line breaks preserved, bullets/numbers converted to Markdown lists, headings inferred only from OCR line-height hints
- The "before" number is different in kind from every other input: it estimates the image tokens a vision model would charge for the raw screenshot, using the provider's published pixel-dimension formula (Claude's 28×28-pixel patch rule with tier-specific downscaling, or GPT-4V/GPT-4o's 512-px tile rule) — selectable via a model dropdown
- No component breakdown — image tokens aren't decomposable, and OCR text has no chrome/content split

**Web page conversion:**
- Content extracted using Mozilla Readability (the engine behind Firefox Reader View), stripping navigation, ads, sidebars, and other page chrome
- Converted to Markdown via Turndown
- Before/after token comparison: HTML "before" count reflects visible markup with scripts and styles removed
- Collapsible breakdown showing main content vs. discarded chrome in the HTML input, and plain text vs. Markdown formatting tokens in the output

> **File size:** There is no hard size limit, but files over roughly 50 MB may be slow to process or may not complete depending on available device memory. DOCX files with many embedded images can also be slow even if the file size appears small.

> **Web page URLs:** URL pasting is not yet supported — browser security restrictions prevent fetching arbitrary URLs client-side. Save the page from your browser and upload the .html file instead.

> **Token estimates:** Counting runs locally with an OpenAI-compatible tokenizer (`o200k_base`). Actual token counts and charges depend on the model, platform, and how that platform processes uploaded files.

Conversions are saved to History (Markdown output plus the before/after comparison) and can be restored later. Document Tools keeps its state — including the current document — when you navigate to another tool and back within the same visit.

Adding a `.docx`, `.html`, `.pdf`, or `.pptx` file, or pasting text, also extracts its links once and hands the same list to both link workflows below, so switching between them never re-extracts or re-checks from scratch. For PDFs, links come from the file's actual link annotations (not just URLs visible as text) — a link's visible label isn't matched yet, so the URL is shown as its own label, same as a bare-URL paste.

**Extract URLs** — a lightweight list of every link in the document (visible text + destination), with a separator choice (new line, space, tab, or comma) for the "Copy URLs" output, plus CSV export. No network requests — just extraction.

**Check AI Indicators** — the same link list, checked for reachability and flagged if a URL contains a known AI-platform tracking tag (e.g. `utm_source=chatgpt.com`). Results can be filtered, sorted, and exported as CSV.

**Features:**
- Concurrent reachability checking (6 links at a time)
- Configurable AI URL tag list
- Filter by flagged or unreachable, sortable columns
- Copy URLs or download results as CSV
- Session history saved locally (Check AI Indicators sessions only)

> **Note:** The tool detects whether a server responded, not what it said. A 404 page still shows as Reachable. Some links redirected through services like LinkedIn or Google may show as Unreachable — always verify flagged results.

**More workflows may be added later** — the document panel and workflow list are built to support additional document-based tools without requiring the document to be re-added.

### SKILL Creator

A guided editor for creating Claude Code skill files (`SKILL.md`). Write your skill's instructions in rich text and watch the generated markdown update in real time. Fill in the skill name and description in the metadata panel, then export the complete skill as a `.zip` folder ready to drop into your Claude workspace.

Designed for instructors and students who may not know markdown — the editor handles formatting and shows the underlying markdown as a live read-only preview.

**Features:**
- Rich-text editor (headings, bold/italic/strikethrough, lists, task lists, tables, code blocks, links)
- Side-by-side layout (WYSIWYG + live markdown preview) or tabbed layout (switch between WYSIWYG and raw markdown)
- Frontmatter fields (name, description) kept separate from the rich-text body
- Save drafts to History, copy markdown to clipboard, or export as ZIP
- Skill entries in History can be restored back into the editor

### Curriculum Planner

Plan an AI curriculum using the AI-Ready Lawyer framework. Drag competency notes into module boxes, add or remove modules, collapse framework sections, and import/export plans as JSON.

**Features:**
- Draggable sticky notes for each pillar, competency, and mastery level
- Dynamic destination boxes for course modules or omitted items
- Search and pillar filtering
- Import/export saved plans as JSON
- Plan state saved locally in browser storage

### History

Document analyses, conversions, saved skill drafts, and curriculum plans are stored in your browser's local storage. Click any card to restore it in its original tool.

## Getting Started (No Coding Required)

You don't need a developer background, an account, or an internet connection (after the page first loads) to use these tools. Everything runs locally in your browser.

**1. Download the tools**
- Go to the project page: [github.com/nickhafen/nh-ai-utilities](https://github.com/nickhafen/nh-ai-utilities)
- Click the green **Code** button, then **Download ZIP**.
- Find the downloaded file (usually in your **Downloads** folder) and unzip it:
  - **Windows:** right-click the ZIP file → **Extract All…**
  - **Mac:** double-click the ZIP file to unzip it automatically.

**2. Open the app**
- Open the unzipped folder.
- Double-click **`index.html`**. It opens in your default web browser (Chrome, Edge, Firefox, or Safari all work).
- That's it — nothing to install. Bookmark the page or pin the tab so it's easy to find again.

**3. If a tool doesn't seem to work**
- A few browsers restrict certain features (like loading the rich-text editor) when a page is opened directly from a folder instead of a web address. If you run into this, try the "Serve it locally" option below, or ask someone technical to open the folder with a tool like VS Code's "Live Server" extension.

**4. Getting updates later**
- Re-download the ZIP and unzip it to get the newest version. Anything saved in **History** lives inside your browser tied to where the page was opened from, so it won't carry over automatically — export anything you want to keep before switching folders.

## Serve it Locally

Open `index.html` in any modern browser — no build step or install required.

For local development, serve the folder with a static file server:

```bash
python3 -m http.server 5173
# then open http://localhost:5173
```

## Privacy

All processing runs in your browser. No content is sent to any server. History is stored in `localStorage` on this device only and is not synced across devices or browsers.

## Roadmap

### Document Tools
- [ ] Add URL-to-Markdown conversion (URL paste path). Requires a lightweight server-side proxy or third-party CORS proxy to work around browser security restrictions on cross-origin fetches.
- [x] Add PowerPoint input — slide order, titles, body text, speaker notes, tables, and chart data with include/exclude toggles.
- [x] Add PDF-to-Markdown conversion — headings, wrapped lines, lists, best-effort tables, header/footer stripping. Scanned pages (OCR fallback) still open.
- [x] Add screenshot OCR. Confidence indicators and scanned-PDF OCR (rasterize page → shared OCR module) still open.
- [ ] Add batch conversion and a ZIP download for multiple inputs. No server needed — the browser can loop the existing per-file pipelines over a multi-file picker/drop and package the results with the ZIP library (JSZip) already used for SKILL Creator exports. A server would only start to matter for things this app doesn't do today: processing large batches in the background after closing the tab, or handling a total upload size too large for one browser tab's memory.
- [ ] Add exact tokenizer choices for additional model and provider families.
- [ ] Add a "semantic budget" preview that highlights content removed by each option before export.
- [ ] Add presets such as "smallest possible," "preserve academic citations," "preserve tables," and "preserve legal structure."
- [ ] Explore an optional LLM-assisted recommendation mode: inspect the document, identify which structures carry meaning, recommend cleanup settings, explain likely tradeoffs, and require confirmation before conversion.

### SKILL Creator
- [ ] Add in-tool instructions explaining what a skill file is and how to use it
- [ ] Add links for installing skill files in Claude Code, ChatGPT, and other platforms
- [ ] Decide on default editor layout — side-by-side preview vs. tabbed WYSIWYG/markdown — or expose the choice as a user preference
- [ ] General copy and UX polish

## Stack

- Vanilla JavaScript — no framework, no bundler, no install step
- [Mammoth.js](https://github.com/mwilliamson/mammoth.js) — semantic `.docx` to HTML conversion (CDN)
- [Turndown](https://github.com/mixmark-io/turndown) — HTML to Markdown conversion (CDN)
- [@mozilla/readability](https://github.com/mozilla/readability) — web page content extraction, same engine as Firefox Reader View (CDN)
- [js-tiktoken](https://www.npmjs.com/package/js-tiktoken) — private, local token estimation using the `o200k_base` encoding (CDN)
- [pdfjs-dist](https://mozilla.github.io/pdf.js/) — client-side PDF text extraction (CDN, lazy-loaded)
- [tesseract.js](https://tesseract.projectnaptha.com/) — local in-browser OCR for screenshots (CDN, lazy-loaded)
- [Toast UI Editor](https://ui.toast.com/tui-editor) — rich-text and markdown editing (CDN)
- [JSZip](https://strtd.github.io/jszip/) — `.docx` parsing and ZIP export (CDN)
