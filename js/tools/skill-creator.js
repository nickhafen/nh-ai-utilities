(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, copyText, escapeHtml } = ns;

  // ── Helpers ──────────────────────────────────────────────────────────────

  // Quotes a YAML scalar only when needed (empty, numeric-looking, a
  // reserved word, or containing characters that would otherwise change its
  // meaning) — mirrors what a human writing frontmatter by hand would do.
  function yamlScalar(value) {
    const s = String(value ?? '');
    if (s === '') return '""';
    if (/^(true|false|null|~)$/i.test(s)) return `"${s}"`;
    if (/^-?\d+(\.\d+)?$/.test(s)) return `"${s}"`;
    if (/^[\s-]|[:#[\]{}&*!|>'"%@`]|\s$/.test(s)) {
      return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return s;
  }

  // Renders the user's additional-field rows as YAML lines. A "group" field
  // (e.g. the skill spec's `metadata:` block) becomes a nested key/value
  // block; rows with an empty name (or, for simple fields, an empty value)
  // are dropped rather than emitted as noise.
  function extraFieldsLines(fields) {
    const lines = [];
    for (const f of fields || []) {
      const key = (f.name || '').trim();
      if (!key) continue;
      if (f.kind === 'group') {
        const subs = (f.subFields || []).filter((sf) => (sf.name || '').trim());
        if (!subs.length) continue;
        lines.push(`${key}:`);
        for (const sf of subs) lines.push(`  ${sf.name.trim()}: ${yamlScalar(sf.value)}`);
      } else if ((f.value || '').trim()) {
        lines.push(`${key}: ${yamlScalar(f.value)}`);
      }
    }
    return lines;
  }

  function buildFullContent(name, description, extraFields, body) {
    const lines = ['---'];
    if (name)        lines.push(`name: ${name}`);
    if (description) lines.push(`description: ${yamlScalar(description)}`);
    lines.push(...extraFieldsLines(extraFields));
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

  function saveToHistory(name, description, extraFields, body) {
    ns.history.add({
      id:          `skill-${Date.now()}`,
      timestamp:   Date.now(),
      sourceLabel: name || 'Untitled Skill',
      inputType:   'skill',
      name,
      description,
      extraFields,
      body,
    });
  }

  const { validateName, validateDescription } = ns.skillFormat;

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

          <!-- Import -->
          <details class="panel skill-import-panel" data-sc-import-panel>
            <summary class="panel-header skill-import-toggle">
              <span class="panel-title">Start from a file <span class="field-hint">(optional: .docx, .md, or .txt)</span></span>
            </summary>
            <div class="skill-import-body" data-sc-import-body>
              <div class="drop-area skill-import-drop" data-sc-drop role="button" tabindex="0" aria-label="Choose a .docx, .md, or .txt file to import">
                <span class="drop-icon">FILE</span>
                <strong class="primary-text">Drop a .docx, .md, or .txt file here</strong>
                <span class="hint">or click to choose. It fills in the fields below and checks them. Nothing is uploaded.</span>
                <input type="file" accept="${ns.skillFormat.ACCEPT}" data-sc-file hidden>
              </div>
              <p class="converter-error" role="alert" data-sc-import-error hidden></p>
              <div class="skill-import-report" data-sc-import-report hidden>
                <div class="skill-import-report-head">
                  <strong data-sc-import-title></strong>
                  <button type="button" class="btn btn-subtle btn-sm extra-remove-btn" data-sc-import-dismiss aria-label="Hide import report">&times;</button>
                </div>
                <ul class="skill-import-list" data-sc-import-list></ul>
              </div>
            </div>
          </details>

          <!-- Metadata -->
          <div class="panel skill-meta-panel">
            <div class="panel-header">
              <span class="panel-title">Metadata</span>
            </div>
            <div class="skill-meta-fields">
              <div class="field">
                <label for="sc-name">Skill Name
                  <span class="field-hint">Max 64 characters. Lowercase letters, numbers, and hyphens only. Must not start or end with a hyphen.</span>
                </label>
                <input id="sc-name" type="text" class="text-input" data-sc-name
                  placeholder="my-skill-name" autocomplete="off" spellcheck="false">
                <p class="field-error" data-sc-name-error hidden></p>
              </div>
              <div class="field skill-desc-field">
                <label for="sc-desc">Description
                  <span class="field-hint">Max 1024 characters. Non-empty. Describes what the skill does and when to use it.</span>
                </label>
                <input id="sc-desc" type="text" class="text-input skill-desc-input" data-sc-desc
                  placeholder="Use this skill when the user asks to…">
                <p class="field-error" data-sc-desc-error hidden></p>
              </div>
            </div>

            <details class="skill-extra-meta" data-sc-extra-meta>
              <summary class="skill-extra-meta-toggle">Additional metadata fields <span class="field-hint">(optional)</span></summary>
              <div class="skill-extra-meta-body">
                <p class="hint">Add any other optional frontmatter fields your skill needs &mdash; e.g. <code>license</code>, <code>allowed-tools</code>, or a nested <code>metadata</code> block of its own key/value pairs. See the <a href="#" data-scroll-to-resources>Resources</a> section below for guidance on what these fields do.</p>
                <div data-extra-fields-list></div>
                <button type="button" class="btn btn-secondary btn-sm extra-add-btn" data-add-extra-field>+ Add field</button>
              </div>
            </details>
          </div>

          <!-- Editor + Preview -->
          <div class="skill-split" data-sc-split>
            <div class="panel skill-editor-panel">
              <div class="panel-header">
                <span class="panel-title">Content</span>
                
              </div>
              <div data-sc-editor></div>
            </div>
            <div class="panel skill-preview-panel" data-sc-preview-panel>
              <div class="panel-header">
                <span class="panel-title">Markdown File Preview</span>
                
              </div>
              <pre class="skill-md-preview" data-sc-preview></pre>
            </div>
          </div>

          <!-- Footer actions -->
          <div class="skill-footer">
            <button class="btn btn-subtle" data-sc-clear>Clear</button>
            <div class="skill-footer-actions">
              <button class="btn btn-secondary" data-sc-copy>Copy Markdown</button>
              <button class="btn btn-secondary" data-sc-save>Save to History</button>
              <button class="btn btn-primary"   data-sc-export>Export ZIP</button>
            </div>
          </div>

          <!-- Resources -->
          <div id="sc-resources" class="panel skill-resources-panel">
            <div class="panel-header">
              <span class="panel-title">Resources</span>
            </div>
            <div class="skill-resources-body">

              <div class="skill-resources-group">
                <h3 class="skill-resources-heading">Skill File Resources</h3>
                <ul class="skill-resources-list">
                  <li>
                    <a href="https://agentskills.io/home" target="_blank" rel="noopener noreferrer">Agent Skills</a>
                    <p>The open, cross-platform format that skills follow (originally from Anthropic). See the <a href="https://agentskills.io/specification" target="_blank" rel="noopener noreferrer">specification</a> for the full file format.</p>
                  </li>
                  <li>
                    <a href="https://code.claude.com/docs/en/skills" target="_blank" rel="noopener noreferrer">Claude Code skill documentation</a>
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
                  <li>
                    <a href="https://support.google.com/docs/answer/12014036" target="_blank" rel="noopener noreferrer">Use Markdown in Google Docs, Slides, & Drawings</a>
                    <p>Instructions for using or exporting markdown in Google Docs.</p>
                  </li>
                </ul>
              </div>

              <!-- Full-width row: platform instructions -->
              <div class="skill-resources-group skill-resources-group--full">
                <h3 class="skill-resources-heading">Using Skill Files in AI Platforms</h3>
                <ul class="skill-resources-list skill-resources-list">
                  <li>
                    <strong><a href="https://support.claude.com/en/articles/12512180-use-skills-in-claude" target="_blank" rel="noopener noreferrer">Claude</a></strong>
                    <p>Upload the skill .zip under Customize &gt; Skills &gt; + &gt; Create skill &gt; Upload a skill. Works on every plan, including Free; code execution must be on (Settings &gt; Capabilities).</p>
                  </li>
                  <li>
                    <strong><a href="https://code.claude.com/docs/en/skills" target="_blank" rel="noopener noreferrer">Claude Code</a></strong>
                    <p>Unzip and put the skill folder in ~/.claude/skills/. Skills uploaded to a claude.ai account also sync to Claude Code when you sign in with that account.</p>
                  </li>
                  <li>
                    <strong><a href="https://help.openai.com/en/articles/20001066-skills-in-chatgpt" target="_blank" rel="noopener noreferrer">ChatGPT</a></strong>
                    <p>Business, Enterprise, Healthcare, and Edu plans only. Upload the .zip under Plugins &gt; Skills &gt; Create &gt; Upload from your computer. ChatGPT scans each upload, and some are marked Needs Review.</p>
                  </li>
                  <li>
                    <strong><a href="https://support.google.com/gemini/answer/17094296" target="_blank" rel="noopener noreferrer">Gemini</a></strong>
                    <p>Personal Google accounts only (not work or school), age 18+, with Keep Activity on; still rolling out. Upload a .zip, a folder, or a SKILL.md under Settings &gt; Skills. It doesn't accept Word (.docx) or JavaScript files, and a skill's scripts can't use the internet. 100 MB limit.</p>
                  </li>
                  <li>
                    <strong><a href="https://agentskills.io/clients" target="_blank" rel="noopener noreferrer">Other platforms</a></strong>
                    <p>List of tools that support Agent Skills, each with a link to its setup steps.</p>
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

      // Friendlier label for the bottom mode switch (merges into Toast's en strings)
      toastui.Editor.setLanguage(['en', 'en-US'], { WYSIWYG: 'Rich Text' });

      // ── DOM refs ────────────────────────────────────────────────────────

      const nameInput      = $('[data-sc-name]',          root);
      const descInput      = $('[data-sc-desc]',          root);
      const nameError      = $('[data-sc-name-error]',    root);
      const descError      = $('[data-sc-desc-error]',    root);
      const preview        = $('[data-sc-preview]',       root);
      const previewPanel   = $('[data-sc-preview-panel]', root);
      const splitEl        = $('[data-sc-split]',         root);
      const exportBtn      = $('[data-sc-export]',        root);
      const copyBtn        = $('[data-sc-copy]',          root);
      const saveBtn        = $('[data-sc-save]',          root);
      const clearBtn       = $('[data-sc-clear]',         root);
      const fillBtn        = $('[data-sc-fill]',          root);
      const layoutToggle   = $('[data-layout-toggle]',    root);
      const extraFieldsEl   = $('[data-sc-extra-meta]',      root);
      const extraFieldsList = $('[data-extra-fields-list]',  root);
      const importPanel     = $('[data-sc-import-panel]',    root);
      const importBody      = $('[data-sc-import-body]',     root);
      const dropzone        = $('[data-sc-drop]',            root);
      const fileInput       = $('[data-sc-file]',            root);
      const importError     = $('[data-sc-import-error]',    root);
      const importReport    = $('[data-sc-import-report]',   root);
      const importTitle     = $('[data-sc-import-title]',    root);
      const importList      = $('[data-sc-import-list]',     root);

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

      // ── Additional metadata fields ──────────────────────────────────────
      //
      // Rather than listing every optional frontmatter field, the user names
      // their own (name/value rows), with an optional "group" mode per row
      // for a nested block like the skill spec's `metadata:` (its own set of
      // key/value sub-fields). State lives in `extraFields`; only add/remove
      // re-renders the row DOM — typing updates state in place via delegated
      // input listeners so focus/cursor position is never lost.

      let extraFields = [];
      let extraFieldSeq = 0;
      const newFieldId = () => `ef${++extraFieldSeq}`;

      // Gives restored or imported fields fresh row ids.
      function withIds(fields) {
        return (fields || []).map((f) => ({
          id: newFieldId(),
          name: f.name || '',
          kind: f.kind === 'group' ? 'group' : 'text',
          value: f.value || '',
          subFields: (f.subFields || []).map((sf) => ({ id: newFieldId(), name: sf.name || '', value: sf.value || '' })),
        }));
      }

      function cloneExtraFields() {
        return extraFields.map((f) => ({ ...f, subFields: (f.subFields || []).map((sf) => ({ ...sf })) }));
      }

      function subFieldsHtml(f) {
        return `
          <div class="extra-subfields" data-subfields-for="${f.id}">
            ${(f.subFields || []).map((sf) => `
              <div class="extra-subfield-row" data-subfield-id="${sf.id}">
                <input type="text" class="text-input" placeholder="Key" data-sub-name value="${escapeHtml(sf.name)}">
                <input type="text" class="text-input" placeholder="Value" data-sub-value value="${escapeHtml(sf.value)}">
                <button type="button" class="btn btn-subtle btn-sm extra-remove-btn" data-remove-subfield aria-label="Remove sub-field">&times;</button>
              </div>
            `).join('')}
            <button type="button" class="btn btn-subtle btn-sm extra-add-btn" data-add-subfield>+ Add sub-field</button>
          </div>
        `;
      }

      function fieldRowHtml(f) {
        return `
          <div class="extra-field-row" data-extra-field-id="${f.id}">
            <div class="extra-field-main">
              <input type="text" class="text-input extra-field-name" placeholder="Field name" data-extra-name value="${escapeHtml(f.name)}" autocomplete="off" spellcheck="false">
              ${f.kind === 'group'
                ? ''
                : `<input type="text" class="text-input extra-field-value" placeholder="Field value" data-extra-value value="${escapeHtml(f.value)}">`}
              <label class="extra-field-nested-toggle" title="Turns this into a nested block of its own key/value pairs, like the skill spec's metadata: field">
                <input type="checkbox" data-extra-nested ${f.kind === 'group' ? 'checked' : ''}> Group
              </label>
              <button type="button" class="btn btn-subtle btn-sm extra-remove-btn" data-remove-extra-field aria-label="Remove field">&times;</button>
            </div>
            ${f.kind === 'group' ? subFieldsHtml(f) : ''}
          </div>
        `;
      }

      function renderExtraFields() {
        extraFieldsList.innerHTML = extraFields.length
          ? extraFields.map(fieldRowHtml).join('')
          : '<p class="hint">No additional fields yet.</p>';
      }

      // ── State helpers ────────────────────────────────────────────────────

      function getValues() {
        return {
          name:        nameInput.value.trim(),
          description: descInput.value.trim(),
          extraFields: cloneExtraFields(),
          body:        editor ? editor.getMarkdown().trim() : '',
        };
      }

      function validateFields() {
        const nameErr = validateName(nameInput.value.trim());
        const descErr = validateDescription(descInput.value.trim());
        nameError.textContent = nameErr || '';
        nameError.hidden = !nameErr;
        nameInput.classList.toggle('input-error', !!nameErr);
        descError.textContent = descErr || '';
        descError.hidden = !descErr;
        descInput.classList.toggle('input-error', !!descErr);
        return !nameErr && !descErr;
      }

      function refresh() {
        if (!editor) return;
        const { name, description, extraFields: ef, body } = getValues();
        preview.textContent = buildFullContent(name, description, ef, body);
        // Persist draft so navigating away and back doesn't clear the fields
        ns.skillCreatorDraft = { name, description, extraFields: ef, body };
        renderImportReport();
      }

      // ── Import from file ────────────────────────────────────────────────
      //
      // The report lists what the import found or fixed (fixed at import
      // time), then checks that re-run on every change, so a "Needed" item
      // turns into a tick once the user fills it in.

      let importState = null; // { fileName, notes }

      const BADGES = { ok: '✓', fixed: 'Fixed', warn: 'Check', needs: 'Needed' };

      function liveChecks() {
        const { name, description, body } = getValues();
        const nameErr = validateName(name);
        const descErr = validateDescription(description);
        const items = [];
        items.push(nameErr
          ? { level: 'needs', text: `Name: ${nameErr}`, focus: 'name' }
          : { level: 'ok', text: `Exports as ${name}.zip containing ${name}/SKILL.md, whatever the original file was called.` });
        items.push(descErr
          ? { level: 'needs', text: descErr === 'Description is required.'
              ? 'Add a description: what the skill does and when to use it. The AI reads this to decide when to load the skill.'
              : `Description: ${descErr} (now ${description.length}).`, focus: 'desc' }
          : { level: 'ok', text: `Description is set (${description.length}/1024 characters).` });
        for (const text of ns.skillFormat.platformWarnings(name, description)) items.push({ level: 'warn', text });
        const lines = body ? body.split('\n').length : 0;
        if (!lines) items.push({ level: 'needs', text: 'No instructions found after the frontmatter. Add them in the Content editor.' });
        else if (lines > ns.skillFormat.BODY_LINE_LIMIT) items.push({ level: 'warn', text: `The instructions are ${lines} lines. Skills work best under ${ns.skillFormat.BODY_LINE_LIMIT}; consider trimming.` });
        return items;
      }

      function renderImportReport() {
        importReport.hidden = !importState;
        importBody.classList.toggle('has-report', !!importState);
        if (!importState) return;
        importTitle.textContent = `Imported ${importState.fileName}`;
        importList.innerHTML = [...importState.notes, ...liveChecks()].map((item) => `
          <li class="skill-import-item is-${item.level}">
            <span class="skill-import-badge">${BADGES[item.level]}</span>
            <span>${escapeHtml(item.text)}${item.focus
              ? ` <button type="button" class="skill-import-fix" data-sc-focus="${item.focus}">Fix</button>`
              : ''}</span>
          </li>
        `).join('');
      }

      async function importSkillFile(file) {
        if (!file) return;
        importError.hidden = true;
        const current = getValues();
        if ((current.name || current.description || current.extraFields.length || current.body)
          && !confirm(`Replace what's in the editor with “${file.name}”?`)) return;

        let result;
        try {
          result = await ns.skillFormat.importFile(file);
        } catch (err) {
          importError.textContent = err.message || 'That file could not be read.';
          importError.hidden = false;
          return;
        }

        nameInput.value = result.name;
        descInput.value = result.description;
        extraFields = withIds(result.extraFields);
        renderExtraFields();
        if (extraFields.length) extraFieldsEl.open = true;
        importState = { fileName: file.name, notes: result.notes };
        editor.setMarkdown(result.body, false); // false: don't move focus into the editor
        refresh();
        if (!validateFields()) (validateName(nameInput.value.trim()) ? nameInput : descInput).focus();
      }

      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
      // The panel starts collapsed, so it accepts a drop anywhere on it
      // (including the closed header) and opens to show the report.
      ['dragenter', 'dragover'].forEach((t) => importPanel.addEventListener(t, (e) => { e.preventDefault(); importPanel.classList.add('drag-over'); }));
      ['dragleave', 'drop'].forEach((t) => importPanel.addEventListener(t, (e) => { e.preventDefault(); importPanel.classList.remove('drag-over'); }));
      importPanel.addEventListener('drop', (e) => {
        importPanel.open = true;
        importSkillFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', () => {
        importSkillFile(fileInput.files[0]);
        fileInput.value = ''; // so choosing the same file again still fires
      });

      importReport.addEventListener('click', (e) => {
        if (e.target.closest('[data-sc-import-dismiss]')) {
          importState = null;
          renderImportReport();
          return;
        }
        const fix = e.target.closest('[data-sc-focus]');
        if (fix) (fix.dataset.scFocus === 'name' ? nameInput : descInput).focus();
      });

      // ── Initial render ───────────────────────────────────────────────────

      // Restore state — History navigation takes priority over in-session draft
      const pending = ns.pendingSkillSession || null;
      ns.pendingSkillSession = null;
      const draft = !pending ? (ns.skillCreatorDraft || null) : null;
      extraFields = withIds(pending?.extraFields || draft?.extraFields);
      renderExtraFields();

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

      nameInput.addEventListener('input', () => { refresh(); validateFields(); });
      descInput.addEventListener('input', () => { refresh(); validateFields(); });

      // A plain #sc-resources href would be swallowed by the app's hash-based
      // tool router (any hash change is treated as "navigate to this tool
      // id"), sending the whole app to whatever tool happens to be first
      // instead of scrolling within this page. Scroll manually instead.
      root.addEventListener('click', (e) => {
        const link = e.target.closest('[data-scroll-to-resources]');
        if (!link) return;
        e.preventDefault();
        $('#sc-resources', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      // ── Additional metadata fields: event delegation ────────────────────

      extraFieldsEl.addEventListener('click', (e) => {
        const addField = e.target.closest('[data-add-extra-field]');
        if (addField) {
          const field = { id: newFieldId(), name: '', kind: 'text', value: '', subFields: [] };
          extraFields.push(field);
          renderExtraFields();
          refresh();
          $(`[data-extra-field-id="${field.id}"] [data-extra-name]`, extraFieldsList)?.focus();
          return;
        }

        const removeField = e.target.closest('[data-remove-extra-field]');
        if (removeField) {
          const row = removeField.closest('[data-extra-field-id]');
          extraFields = extraFields.filter((f) => f.id !== row.dataset.extraFieldId);
          renderExtraFields();
          refresh();
          return;
        }

        const addSub = e.target.closest('[data-add-subfield]');
        if (addSub) {
          const row = addSub.closest('[data-extra-field-id]');
          const field = extraFields.find((f) => f.id === row.dataset.extraFieldId);
          if (field) {
            const sub = { id: newFieldId(), name: '', value: '' };
            field.subFields.push(sub);
            renderExtraFields();
            refresh();
            $(`[data-subfield-id="${sub.id}"] [data-sub-name]`, extraFieldsList)?.focus();
          }
          return;
        }

        const removeSub = e.target.closest('[data-remove-subfield]');
        if (removeSub) {
          const fieldRow = removeSub.closest('[data-extra-field-id]');
          const subRow = removeSub.closest('[data-subfield-id]');
          const field = extraFields.find((f) => f.id === fieldRow.dataset.extraFieldId);
          if (field) {
            field.subFields = field.subFields.filter((sf) => sf.id !== subRow.dataset.subfieldId);
            renderExtraFields();
            refresh();
          }
        }
      });

      extraFieldsEl.addEventListener('change', (e) => {
        const nestedToggle = e.target.closest('[data-extra-nested]');
        if (!nestedToggle) return;
        const row = nestedToggle.closest('[data-extra-field-id]');
        const field = extraFields.find((f) => f.id === row.dataset.extraFieldId);
        if (!field) return;
        field.kind = nestedToggle.checked ? 'group' : 'text';
        if (field.kind === 'group' && !field.subFields.length) field.subFields.push({ id: newFieldId(), name: '', value: '' });
        renderExtraFields();
        refresh();
      });

      extraFieldsEl.addEventListener('input', (e) => {
        const fieldRow = e.target.closest('[data-extra-field-id]');
        if (!fieldRow) return;
        const field = extraFields.find((f) => f.id === fieldRow.dataset.extraFieldId);
        if (!field) return;

        if (e.target.matches('[data-extra-name]')) field.name = e.target.value;
        else if (e.target.matches('[data-extra-value]')) field.value = e.target.value;
        else if (e.target.matches('[data-sub-name]') || e.target.matches('[data-sub-value]')) {
          const subRow = e.target.closest('[data-subfield-id]');
          const sub = field.subFields.find((sf) => sf.id === subRow.dataset.subfieldId);
          if (sub) {
            if (e.target.matches('[data-sub-name]')) sub.name = e.target.value;
            else sub.value = e.target.value;
          }
        }
        refresh();
      });

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
        const { name, description, extraFields: ef, body } = getValues();
        if (!name && !description && !ef.length && !body) return;
        if (!confirm('Clear all content? This cannot be undone.')) return;
        nameInput.value = '';
        descInput.value = '';
        editor.setMarkdown('');
        extraFields = [];
        renderExtraFields();
        ns.skillCreatorDraft = null;
        importState = null;
        importError.hidden = true;
        refresh();
        validateFields();
      });

      copyBtn.addEventListener('click', () => {
        withFeedback(copyBtn, '✓ Copied', async () => {
          const { name, description, extraFields: ef, body } = getValues();
          await copyText(preview.textContent);
          saveToHistory(name, description, ef, body);
        });
      });

      saveBtn.addEventListener('click', () => {
        withFeedback(saveBtn, '✓ Saved to History', async () => {
          const { name, description, extraFields: ef, body } = getValues();
          saveToHistory(name, description, ef, body);
        });
      });

      exportBtn.addEventListener('click', async () => {
        const { name, description, extraFields: ef, body } = getValues();
        if (!validateFields()) {
          (validateName(name) ? nameInput : descInput).focus();
          return;
        }
        withFeedback(exportBtn, '✓ Exported', async () => {
          await downloadZip(name, preview.textContent);
          saveToHistory(name, description, ef, body);
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
        validateFields();
      });
    },
  });
})();
