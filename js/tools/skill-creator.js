(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, copyText } = ns;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function buildFullContent(name, description, body) {
    const lines = ['---'];
    if (name)        lines.push(`name: ${name}`);
    if (description) lines.push(`description: ${description}`);
    lines.push('---');
    const fm = lines.join('\n');
    return body ? `${fm}\n\n${body}` : `${fm}\n`;
  }

  function toSlug(name) {
    return (name || 'skill')
      .trim()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'skill';
  }

  function saveToHistory(name, description, body) {
    ns.history.add({
      id:          `skill-${Date.now()}`,
      timestamp:   Date.now(),
      sourceLabel: name || 'Untitled Skill',
      inputType:   'skill',
      name,
      description,
      body,
    });
  }

  async function downloadZip(name, content) {
    const slug = toSlug(name);
    const zip  = new JSZip();
    zip.folder(slug).file('SKILL.md', content);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${slug}.zip` });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function withFeedback(btn, successLabel, fn) {
    const orig = btn.textContent;
    btn.disabled = true;
    try {
      await fn();
      btn.textContent = successLabel;
      btn.classList.add('btn-success');
    } catch {
      btn.textContent = '✗ Failed';
    }
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('btn-success');
      btn.disabled = false;
    }, 2000);
  }

  // ── Tool ─────────────────────────────────────────────────────────────────

  ns.registerTool({
    id:   'skill-creator',
    name: 'SKILL Creator',
    description: 'Create and export a Claude Code SKILL.md file',

    render(root) {
      root.innerHTML = `
        <div class="skill-creator" data-sc-root>

          <!-- Metadata -->
          <div class="panel skill-meta-panel">
            <div class="panel-header">
              <span class="panel-title">Skill Metadata</span>
            </div>
            <div class="skill-meta-fields">
              <div class="field">
                <label for="sc-name">Skill Name
                  <span class="field-hint">kebab-case — used as the export folder name</span>
                </label>
                <input id="sc-name" type="text" class="text-input" data-sc-name
                  placeholder="my-skill-name" autocomplete="off" spellcheck="false">
              </div>
              <div class="field skill-desc-field">
                <label for="sc-desc">Description
                  <span class="field-hint">goes in the file's frontmatter — Claude uses this to decide when to trigger the skill</span>
                </label>
                <input id="sc-desc" type="text" class="text-input skill-desc-input" data-sc-desc
                  placeholder="Use this skill when the user asks to…">
              </div>
            </div>
          </div>

          <!-- Editor + Preview -->
          <div class="skill-split" data-sc-split>
            <div class="panel skill-editor-panel">
              <div class="panel-header">
                <span class="panel-title">Content</span>
                <span class="hint">Write the skill's instructions in rich text</span>
              </div>
              <div data-sc-editor></div>
            </div>
            <div class="panel skill-preview-panel" data-sc-preview-panel>
              <div class="panel-header">
                <span class="panel-title">Markdown File Preview</span>
                <span class="hint">Exactly what will be inside SKILL.md</span>
              </div>
              <pre class="skill-md-preview" data-sc-preview></pre>
            </div>
          </div>

          <!-- Footer actions -->
          <div class="skill-footer">
            <button class="btn btn-subtle" data-sc-clear>Clear</button>
            <div class="skill-footer-actions">
              <button class="btn btn-secondary" data-sc-copy>Copy Markdown</button>
              <button class="btn btn-secondary" data-sc-save>Save</button>
              <button class="btn btn-primary"   data-sc-export>Export ZIP</button>
            </div>
          </div>

          <!-- Resources -->
          <div class="panel skill-resources-panel">
            <div class="panel-header">
              <span class="panel-title">Resources</span>
            </div>
            <div class="skill-resources-body">

              <div class="skill-resources-group">
                <h3 class="skill-resources-heading">Skill File Resources</h3>
                <ul class="skill-resources-list">
                  <li>
                    <a href="https://code.claude.com/docs/en/skills" target="_blank" rel="noopener noreferrer">Claude Skill Documentation</a>
                    <p>Official docs covering skill structure, frontmatter fields, and how Claude applies skills.</p>
                  </li>
                  <li>
                    <a href="https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf" target="_blank" rel="noopener noreferrer">The Complete Guide to Building Skills for Claude</a>
                    <p>In-depth PDF guide from Anthropic on skill design, writing effective instructions, and best practices.</p>
                  </li>
                  <li>
                    <a href="https://github.com/anthropics/knowledge-work-plugins/tree/main/legal/skills" target="_blank" rel="noopener noreferrer">Example Skills (Legal)</a>
                    <p>Real-world skill examples from Anthropic's knowledge-work repository — useful as templates and inspiration.</p>
                  </li>
                </ul>
              </div>

              <div class="skill-resources-group">
                <h3 class="skill-resources-heading">Markdown Resources</h3>
                <ul class="skill-resources-list">
                  <li>
                    <a href="https://www.markdownguide.org/cheat-sheet/" target="_blank" rel="noopener noreferrer">Markdown Cheat Sheet</a>
                    <p>Quick reference for markdown syntax — headings, bold, lists, links, code blocks, and more.</p>
                  </li>
                  <li>
                    <a href="https://stackedit.io/app#" target="_blank" rel="noopener noreferrer">StackEdit — In-Browser Markdown Editor</a>
                    <p>Online editor for writing and previewing markdown files directly in the browser.</p>
                  </li>
                </ul>
              </div>

              <!-- Full-width row: platform instructions (links TBD) -->
              <div class="skill-resources-group skill-resources-group--full">
                <h3 class="skill-resources-heading">Using Skill Files in AI Platforms</h3>
                <ul class="skill-resources-list skill-resources-list--cols">
                  <li>
                    <strong>Claude Code</strong>
                    <p>How to install and activate a skill file in Claude Code. <em>Link coming soon.</em></p>
                  </li>
                  <li>
                    <strong>ChatGPT</strong>
                    <p>Equivalent instructions for using custom instructions or GPT configuration files in ChatGPT. <em>Link coming soon.</em></p>
                  </li>
                  <li>
                    <strong>Other Platforms</strong>
                    <p>Instructions for Copilot, Gemini, or other AI assistants that support custom skill or instruction files. <em>Links coming soon.</em></p>
                  </li>
                </ul>
              </div>

            </div>
          </div>

          <!-- Developer Tools -->
          <details class="dev-tools">
            <summary class="dev-tools-toggle">Developer Tools</summary>
            <div class="dev-tools-body">
              <div class="field">
                <label>Auto-fill</label>
                <button class="btn btn-secondary" data-sc-fill>Fill Test Data</button>
              </div>
              <div class="field">
                <label>Layout</label>
                <div class="segmented" data-layout-toggle>
                  <button aria-pressed="true"  data-layout="split">Side-by-side</button>
                  <button aria-pressed="false" data-layout="tabs">Tabs</button>
                </div>
              </div>
            </div>
          </details>

        </div>
      `;

      if (!window.toastui?.Editor) {
        $('[data-sc-editor]', root).innerHTML =
          '<p class="hint" style="padding:1rem 1rem 1.5rem">Editor is loading… If this persists, refresh the page.</p>';
        return;
      }

      // ── DOM refs ────────────────────────────────────────────────────────

      const nameInput    = $('[data-sc-name]',         root);
      const descInput    = $('[data-sc-desc]',         root);
      const preview      = $('[data-sc-preview]',      root);
      const previewPanel = $('[data-sc-preview-panel]',root);
      const splitEl      = $('[data-sc-split]',        root);
      const exportBtn    = $('[data-sc-export]',       root);
      const copyBtn      = $('[data-sc-copy]',         root);
      const saveBtn      = $('[data-sc-save]',         root);
      const clearBtn     = $('[data-sc-clear]',        root);
      const fillBtn      = $('[data-sc-fill]',         root);
      const layoutToggle = $('[data-layout-toggle]',   root);

      // ── Editor lifecycle ────────────────────────────────────────────────

      let editor    = null;
      let layoutMode = 'split'; // 'split' | 'tabs'

      const TOOLBAR = [
        ['heading', 'bold', 'italic', 'strike'],
        ['ul', 'ol', 'task'],
        ['table'],
        ['code', 'codeblock'],
        ['quote', 'hr'],
        ['link'],
      ];

      function createEditor(mode, initialMarkdown) {
        if (editor) {
          editor.destroy();
          editor = null;
        }

        const mount = $('[data-sc-editor]', root);
        mount.innerHTML = '';

        const isSplit = mode === 'split';
        previewPanel.hidden = !isSplit;
        splitEl.classList.toggle('skill-split-full', !isSplit);

        editor = new toastui.Editor({
          el:              mount,
          height:          '480px',
          initialEditType: 'wysiwyg',
          hideModeSwitch:  isSplit,
          toolbarItems:    TOOLBAR,
        });

        if (initialMarkdown) editor.setMarkdown(initialMarkdown);
        editor.on('change', refresh);
        refresh();
      }

      // ── State helpers ────────────────────────────────────────────────────

      function getValues() {
        return {
          name:        nameInput.value.trim(),
          description: descInput.value.trim(),
          body:        editor ? editor.getMarkdown().trim() : '',
        };
      }

      function refresh() {
        if (!editor) return;
        const { name, description, body } = getValues();
        preview.textContent = buildFullContent(name, description, body);
        // Persist draft so navigating away and back doesn't clear the fields
        ns.skillCreatorDraft = { name, description, body };
      }

      // ── Initial render ───────────────────────────────────────────────────

      // Restore state — History navigation takes priority over in-session draft
      const pending = ns.pendingSkillSession || null;
      ns.pendingSkillSession = null;
      const draft = !pending ? (ns.skillCreatorDraft || null) : null;

      createEditor('split', pending?.body || draft?.body || '');

      if (pending) {
        nameInput.value = pending.name || '';
        descInput.value = pending.description || '';
        refresh();
      } else if (draft) {
        nameInput.value = draft.name || '';
        descInput.value = draft.description || '';
        refresh();
      }

      nameInput.addEventListener('input', refresh);
      descInput.addEventListener('input', refresh);

      // ── Layout toggle ────────────────────────────────────────────────────

      layoutToggle.addEventListener('click', e => {
        const btn = e.target.closest('[data-layout]');
        if (!btn || btn.getAttribute('aria-pressed') === 'true') return;

        layoutToggle.querySelectorAll('[data-layout]').forEach(b =>
          b.setAttribute('aria-pressed', String(b === btn))
        );

        const md = editor ? editor.getMarkdown() : '';
        layoutMode = btn.dataset.layout;
        createEditor(layoutMode, md);
      });

      // ── Toolbar buttons ──────────────────────────────────────────────────

      clearBtn.addEventListener('click', () => {
        const { name, description, body } = getValues();
        if (!name && !description && !body) return;
        if (!confirm('Clear all content? This cannot be undone.')) return;
        nameInput.value = '';
        descInput.value = '';
        editor.setMarkdown('');
        ns.skillCreatorDraft = null;
        refresh();
      });

      copyBtn.addEventListener('click', () => {
        withFeedback(copyBtn, '✓ Copied', async () => {
          const { name, description, body } = getValues();
          await copyText(preview.textContent);
          saveToHistory(name, description, body);
        });
      });

      saveBtn.addEventListener('click', () => {
        withFeedback(saveBtn, '✓ Saved', async () => {
          const { name, description, body } = getValues();
          saveToHistory(name, description, body);
        });
      });

      exportBtn.addEventListener('click', async () => {
        const { name, description, body } = getValues();
        if (!name) {
          nameInput.focus();
          nameInput.classList.add('input-error');
          setTimeout(() => nameInput.classList.remove('input-error'), 2000);
          return;
        }
        withFeedback(exportBtn, '✓ Exported', async () => {
          await downloadZip(name, preview.textContent);
          saveToHistory(name, description, body);
        });
      });

      // ── Dev: auto-fill ───────────────────────────────────────────────────

      fillBtn.addEventListener('click', () => {
        nameInput.value = 'summarize-research-paper';
        descInput.value = 'Use this skill when the user asks to summarize, analyze, or review a research paper or academic article';
        editor.setMarkdown([
          '## Overview',
          '',
          'Use this skill to produce clear, structured summaries of academic papers and research articles. Adapt the depth and length of the summary to match the user\'s stated purpose.',
          '',
          '## Before You Begin',
          '',
          'Ask the user if they have a specific goal in mind — for example, understanding the methodology, preparing a literature review, or explaining findings to a non-expert audience.',
          '',
          '## Summary Structure',
          '',
          'Organize your response using these sections:',
          '',
          '**Research Question** — What problem or gap does this paper address?',
          '',
          '**Methods** — How did the researchers investigate it? Include sample size, data sources, and key frameworks.',
          '',
          '**Key Findings** — What did the study discover? Highlight the most significant results.',
          '',
          '**Limitations** — What are the study\'s acknowledged weaknesses?',
          '',
          '**Practical Takeaways** — What are the actionable implications for practitioners or future researchers?',
          '',
          '## Tone and Style',
          '',
          '- Write at a level appropriate for the user\'s background',
          '- Avoid jargon unless the user is a domain expert',
          '- Aim for 300–500 words unless otherwise requested',
        ].join('\n'));
        refresh();
      });
    },
  });
})();
