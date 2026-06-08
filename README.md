# NH AI Utilities

Browser-based tools for AI-assisted academic and professional work. No sign-in, no server, no uploads — everything runs locally in your browser.

## Tools

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

### SKILL Creator
- [ ] Add in-tool instructions explaining what a skill file is and how to use it
- [ ] Add links for installing skill files in Claude Code, ChatGPT, and other platforms
- [ ] Decide on default editor layout — side-by-side preview vs. tabbed WYSIWYG/markdown — or expose the choice as a user preference
- [ ] General copy and UX polish

## Stack

- Vanilla JavaScript — no framework, no bundler, no install step
- [Toast UI Editor](https://ui.toast.com/tui-editor) — rich-text and markdown editing (CDN)
- [JSZip](https://strtd.github.io/jszip/) — `.docx` parsing and ZIP export (CDN)
