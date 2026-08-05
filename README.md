# AI Utilities

Browser-based tools for AI-assisted academic and professional work. No sign-in, no server, no uploads — everything runs locally in your browser.

## Tools

### Token Saver

Convert Word documents and saved web pages to Markdown before sharing with an AI tool. Everything runs locally in the browser — no content leaves your device.

**Supported inputs:**
- `.docx` — Word documents
- `.html` / `.htm` — web pages saved via "Save Page As → Webpage, HTML Only"

**DOCX conversion:**
- Converts to Markdown using semantic HTML as an intermediate representation
- Optional removal of inline formatting, headers and footers, page numbers, images, comments, and excess whitespace
- Compact Markdown footnotes without return-link overhead
- Preserved hyperlink destinations
- Before/after token comparison: DOCX "before" count reflects raw XML across all document parts — the actual data an AI tool processes when a DOCX is uploaded directly
- Collapsible breakdown showing what's driving token cost in both the DOCX input (body, styles, footnotes, headers/footers, numbering, settings) and the Markdown output (plain text vs. formatting syntax)

**Web page conversion:**
- Content extracted using Mozilla Readability (the engine behind Firefox Reader View), stripping navigation, ads, sidebars, and other page chrome
- Converted to Markdown via Turndown
- Before/after token comparison: HTML "before" count reflects visible markup with scripts and styles removed
- Collapsible breakdown showing main content vs. discarded chrome in the HTML input, and plain text vs. Markdown formatting tokens in the output

> **File size:** There is no hard size limit, but files over roughly 50 MB may be slow to process or may not complete depending on available device memory. DOCX files with many embedded images can also be slow even if the file size appears small.

> **Web page URLs:** URL pasting is not yet supported — browser security restrictions prevent fetching arbitrary URLs client-side. Save the page from your browser and upload the .html file instead.

> **Token estimates:** Counting runs locally with an OpenAI-compatible tokenizer (`o200k_base`). Actual token counts and charges depend on the model, platform, and how that platform processes uploaded files.

### Document Tools

Paste or upload a `.docx` file to extract and analyze all hyperlinks. Each link is checked for reachability and flagged if it contains known AI-platform tracking tags (e.g. `utm_source=chatgpt.com`). Results can be filtered, sorted, and exported as CSV.

**Features:**
- Drag-and-drop `.docx` upload or paste rich text
- Concurrent reachability checking (6 links at a time)
- Configurable AI URL tag list
- Filter by flagged or unreachable, sortable columns
- Copy URLs or download results as CSV
- Session history saved locally

> **Note:** The tool detects whether a server responded, not what it said. A 404 page still shows as Reachable. Some links redirected through services like LinkedIn or Google may show as Unreachable — always verify flagged results.

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

All document analyses and saved skill drafts are stored in your browser's local storage. Click any card to restore it in its original tool.

## Usage

Open `index.html` in any modern browser — no build step or install required.

For local development, serve the folder with a static file server:

```bash
python3 -m http.server 5173
# then open http://localhost:5173
```

## Privacy

All processing runs in your browser. No content is sent to any server. History is stored in `localStorage` on this device only and is not synced across devices or browsers.

## Roadmap

### Token Saver
- [ ] Add URL-to-Markdown conversion (URL paste path). Requires a lightweight server-side proxy or third-party CORS proxy to work around browser security restrictions on cross-origin fetches.
- [ ] Add PowerPoint input. Start with structured JSON for slide order, titles, body text, speaker notes, tables, and media references.
- [ ] Add PDF-to-Markdown conversion with layout-aware handling for headings, columns, tables, captions, headers, footers, and scanned pages.
- [ ] Add screenshot and scanned-document OCR, with confidence indicators and optional layout reconstruction.
- [ ] Add batch conversion and a ZIP download for multiple inputs.
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
- [Toast UI Editor](https://ui.toast.com/tui-editor) — rich-text and markdown editing (CDN)
- [JSZip](https://strtd.github.io/jszip/) — `.docx` parsing and ZIP export (CDN)
