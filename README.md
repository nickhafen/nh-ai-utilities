# AI Utilities

A lightweight, browser-based toolkit for instructors and students working with AI-generated content. All tools run entirely in your browser — no files or URLs are sent to any server.

## Tools

### Link Checker
Upload a Word document (`.docx`) and scan it for hyperlinks or visible text containing AI platform tracking tags (e.g., `utm_source=chatgpt.com`). Useful for identifying sources that students retrieved through an AI tool. The tag list is fully customizable.

### URL Extractor
Paste rich text — from a document, email, or web page — and extract a clean list of URLs ready to copy. Supports line-separated or comma-separated output. Designed to feed directly into tools like NotebookLM.

### Dead Links
Paste a list of URLs and check which ones are reachable. Runs up to six checks at a time and flags URLs that return no response, which often indicates a hallucinated or broken citation. Pairs naturally with the URL Extractor.

> **Limitation:** The tool can only detect whether a server responded, not what it said back. A page returning a "404 Not Found" will still show as Reachable. Some legitimate links wrapped or redirected by services like LinkedIn or Google may show as Unreachable — always double-check flagged results.

## Usage

Open `index.html` directly in any modern browser. No build step or server required.

## Potential Future Features

- **404 detection** — distinguishing "server responded with an error" from "server responded successfully" requires routing requests through a proxy, since browsers cannot read cross-origin response status codes. A lightweight Cloudflare Worker or similar could enable this without sending document content to a third party.
- **Footnote extractor** — pull footnote and endnote text from `.docx` files, not just hyperlinks.
- **AI policy clause builder** — generate syllabus language for AI use policies from a short form.
- **AI use disclosure generator** — help students produce a standardized disclosure statement to attach to submissions.
