(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const dom = ns; const $ = dom["$"]; const $$ = dom["$$"]; const { escapeHtml, copyText } = ns;

  const levels = ["Emerging", "Practicing", "Leading"];
  const pillars = [
    { id: "p1", title: "Understand: AI Fluency", short: "AI Fluency", focus: "Know the technology, its capabilities, and its limits.", color: "#8fb8a0", competencies: [
      { name: "Foundational AI Knowledge", notes: { Emerging: "Understands key concepts including how large language models generate output, training data, context windows, temperature, probabilistic systems, and why AI sometimes produces incorrect information. Knows core terms: RAG, agentic AI, model vs. system.", Practicing: "Explains foundational concepts to colleagues, understands how AI architectures affect reliability, and adjusts tool behavior for different tasks based on technical understanding.", Leading: "Evaluates new AI architectures and tools, explains technical concepts to colleagues and clients, and contributes to organizational AI adoption decisions." } },
      { name: "Effective AI Interaction", notes: { Emerging: "Writes basic prompts, recognizes that prompt quality affects output quality, and begins using AI as a thought partner for stress-testing arguments and surfacing counterarguments.", Practicing: "Crafts structured, context-rich prompts, iterates to refine outputs, adapts strategies by tool and task, and uses AI to challenge reasoning and sharpen arguments.", Leading: "Designs reusable prompt templates, trains colleagues on advanced interaction strategies, builds prompt libraries, and teaches sophisticated analytical dialogue with AI." } },
      { name: "Tool Awareness and Selection", notes: { Emerging: "Knows which AI tools an employer provides or permits, their intended uses, and the difference between approved and unapproved tools.", Practicing: "Compares tools against specific tasks, evaluates whether use is worthwhile based on likely time saved and accuracy, and contributes to tool evaluation.", Leading: "Leads or contributes to procurement, benchmarks tools against practice-specific needs and security requirements, and evaluates vendor claims critically." } },
      { name: "Recognizing AI Failure Modes", notes: { Emerging: "Knows AI can hallucinate citations, produce biased outputs, and generate plausible but incorrect analysis. Understands confident output is not necessarily accurate.", Practicing: "Identifies common failure patterns, understands when confidence does not equal accuracy, and predicts which tasks are more likely to produce unreliable output.", Leading: "Develops testing protocols and guardrails for AI failures, contributes to quality assurance standards, and shares failure-mode knowledge systematically." } }
    ] },
    { id: "p2", title: "Apply: AI-Enhanced Legal Work", short: "AI-Enhanced Work", focus: "Integrate AI into research, drafting, investigation, and client service.", color: "#79b7c3", competencies: [
      { name: "AI-Assisted Research", notes: { Emerging: "Uses AI research tools to generate starting points for legal research, then verifies results using established methods.", Practicing: "Creates efficient research workflows, benchmarks AI research quality against traditional methods, and recognizes when AI research is insufficient.", Leading: "Designs research strategies combining AI and traditional tools based on the question type, and establishes team-level research protocols." } },
      { name: "AI-Assisted Drafting and Review", notes: { Emerging: "Uses AI to generate initial drafts or spot issues in documents, then applies legal judgment to edit and refine.", Practicing: "Integrates AI drafting into regular workflow while controlling structure, strategy, and nuance, and adapts output to voice and client expectations.", Leading: "Builds reusable drafting templates and workflows, and establishes quality benchmarks for AI-assisted documents across practice areas." } },
      { name: "AI-Assisted Investigation and Analysis", notes: { Emerging: "Understands AI can assist with pattern-finding in document sets, cross-referencing testimony, and synthesizing factual information across sources.", Practicing: "Uses AI for discovery, due diligence, and document review; identifies patterns and inconsistencies; and integrates findings with traditional investigation.", Leading: "Designs AI-assisted investigation workflows, establishes protocols for discovery and large-scale document analysis, and benchmarks tools against manual methods." } },
      { name: "Client and Stakeholder Service and Communication", notes: { Emerging: "Understands AI can improve responsiveness and deliverables while communication remains human, and recognizes recipients vary in comfort with AI-assisted work.", Practicing: "Uses AI to draft updates, summarize developments, and prepare client-ready materials while maintaining judgment and transparency when appropriate.", Leading: "Develops best practices for AI-enhanced communications, advises on discussing AI use, and helps shape expectations around AI-assisted services." } },
      { name: "Workflow Integration", notes: { Emerging: "Begins incorporating AI into discrete tasks and recognizes which tasks or subtasks are appropriate to delegate to AI versus handle directly.", Practicing: "Redesigns personal workflows to include AI, tracks quality and efficiency, and makes deliberate decisions about delegation, framing, and control.", Leading: "Designs team-level AI workflows, leads process improvement, shares effective workflows, and develops delegation frameworks without abdicating judgment." } }
    ] },
    { id: "p3", title: "Verify: Critical Oversight", short: "Critical Oversight", focus: "Check, question, and quality-control everything AI produces.", color: "#e5c75c", competencies: [
      { name: "Verification and Quality Assurance", notes: { Emerging: "Understands the obligation to verify AI-generated citations, facts, and legal analysis before relying on them, and can spot clearly inadequate output.", Practicing: "Applies systematic verification: checks citations against primary sources, validates factual claims and reasoning, and decides when output needs refinement or rework.", Leading: "Develops verification checklists and protocols, identifies subtle errors, and sets quality benchmarks others can use as rubrics." } },
      { name: "Preserving Independent Judgment", notes: { Emerging: "Understands anchoring bias and that AI should support rather than replace legal thinking.", Practicing: "Forms independent views before consulting AI, uses AI as a check rather than a substitute, and reconciles differences rigorously.", Leading: "Models and mentors independent thinking, designs training that strengthens judgment alongside AI fluency, and helps others resist over-reliance." } },
      { name: "Supervising AI-Assisted Work", notes: { Emerging: "Understands supervising attorneys are responsible for all work product whether or not AI was involved, and documents AI involvement when required.", Practicing: "Reviews AI-assisted work with rigor, flags issues for supervisors, and applies verification protocols consistently.", Leading: "Develops review standards, advises supervisors on reviewing AI-assisted output, and trains others on oversight practices." } }
    ] },
    { id: "p4", title: "Govern: Ethical AI Governance", short: "Ethical Governance", focus: "Navigate confidentiality, compliance, data governance, bias, and disclosure.", color: "#d98f83", competencies: [
      { name: "Confidentiality and Data Protection", notes: { Emerging: "Understands that entering data into AI tools may breach confidentiality, follows organizational policies, and distinguishes approved from unapproved tools.", Practicing: "Evaluates tools for data handling before use, raises exposure concerns, and applies professional standards to AI interactions involving client information.", Leading: "Assesses new tools for security and confidentiality risks, and advises colleagues on safe data practices." } },
      { name: "Data Governance and Client Requirements", notes: { Emerging: "Understands clients may restrict AI use through outside counsel guidelines and knows to check restrictions before using AI on a matter.", Practicing: "Navigates client-specific restrictions, tracks requirements, evaluates vendor data terms, and identifies cross-border data considerations.", Leading: "Contributes to data governance policies, systems for tracking client requirements, outside counsel guideline discussions, and vendor management." } },
      { name: "Regulatory Compliance", notes: { Emerging: "Knows the ABA, state bars, and courts are issuing AI guidance and follows organizational policies.", Practicing: "Stays current on applicable rules, integrates compliance into daily practice, and identifies issues before they arise.", Leading: "Monitors regulatory developments, helps shape organizational compliance policies, and participates in professional discussions about AI regulation." } },
      { name: "Transparency and Disclosure", notes: { Emerging: "Understands courts, clients, and organizational policies may require disclosure of AI use in legal work.", Practicing: "Follows disclosure protocols and identifies situations where notice is required or advisable even when not strictly mandated.", Leading: "Develops disclosure policies, stays current on evolving requirements, and advises on disclosure strategy for novel situations." } },
      { name: "Fairness and Bias Vigilance", notes: { Emerging: "Understands AI tools can reflect and amplify biases in training data, potentially affecting legal analysis and outcomes.", Practicing: "Evaluates AI outputs for bias in research, case assessments, and drafted materials, and raises concerns when bias may affect matters.", Leading: "Designs bias-checking processes and advocates for equitable AI practices in tool selection and deployment." } }
    ] },
    { id: "p5", title: "Evolve: Professional Evolution", short: "Professional Evolution", focus: "Adapt, learn continuously, and lead in a changing profession.", color: "#b69bd1", competencies: [
      { name: "Continuous Learning and Change Leadership", notes: { Emerging: "Recognizes AI tools and best practices change rapidly, staying current is a professional obligation, and experimentation is necessary.", Practicing: "Seeks training, experiments with new tools, stays current on practice-area developments, and advocates thoughtful adoption.", Leading: "Builds learning systems, shares knowledge through trainings and publications, leads adoption, bridges technical and legal teams, and contributes publicly." } },
      { name: "Developing Complementary Strengths", notes: { Emerging: "Understands AI changes which lawyer skills are most valuable, and that judgment, empathy, creativity, and relationships matter more than ever.", Practicing: "Actively develops independent judgment, client relationships, creative strategy, and nuanced communication through targeted experiences.", Leading: "Articulates the evolving value proposition of lawyers, mentors others on complementary skills, and contributes to professional discussion." } },
      { name: "Mentoring and Knowledge Sharing", notes: { Emerging: "Shares useful tips, prompts, and workflow ideas with colleagues informally.", Practicing: "Creates prompt libraries and workflow guides, helps colleagues develop AI skills, and answers questions constructively.", Leading: "Designs and delivers AI training, builds knowledge-sharing infrastructure, and mentors junior colleagues systematically." } }
    ] }
  ];

  const noteColors = { Emerging: "#fff8c5", Practicing: "#ffedd5", Leading: "#fee2e2" };
  const defaultModules = ["Module 1: Foundations and fluency", "Module 2: AI-enhanced legal work", "Module 3: Verification and ethics", "Module 4: Professional readiness"];
  const stateKey = "ai-utilities-curriculum-planner-v2";
  const notes = buildNotes();

  ns.registerTool({
    id: "curriculum-planner",
    name: "AI Curriculum Planner",
    description: "Plan an AI lawyering curriculum with draggable competency notes",
    render(root) {
      let state = loadState();
      root.innerHTML = `
        <div class="tool-view curriculum-planner" data-cp-root>
          <section class="panel">
            <div class="panel-header">
              <div><span class="panel-title">AI Curriculum Planner</span><p class="cp-subtitle">Arrange AI-Ready Lawyer competencies into course modules. Content from <a href="https://cms.pli.edu/globalassets/resources/ai-competency/The-AI-Ready-Lawyer.pdf" target="_blank">PLI's AI-Ready Lawyer Framework</a>.</p></div>
              <div class="panel-actions">
                <input class="text-input cp-search" data-cp-search type="search" placeholder="Search notes">
                <select class="text-input cp-select" data-cp-pillar></select>
                <button class="btn btn-secondary" type="button" data-cp-import>Import</button>
                <input data-cp-import-file type="file" accept="application/json,.json" hidden>
                <div class="export-wrap"><button class="btn btn-secondary" type="button" data-cp-export-toggle>Export ▾</button><div class="export-menu" data-cp-export-menu hidden><button type="button" data-cp-export="copy-json">Copy JSON</button><button type="button" data-cp-export="download-json">Download JSON</button></div></div>
                <button class="btn btn-subtle" type="button" data-cp-reset>Reset</button>
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <div><span class="panel-title">Module Plan</span><p class="cp-subtitle">Drop notes into the destination boxes where they fit best.</p></div>
              <div class="panel-actions"><span class="cp-stats" data-cp-stats></span><button class="btn btn-secondary" type="button" data-cp-save-history>Save to History</button><button class="btn btn-primary" type="button" data-cp-add-module>Add module</button></div>
            </div>
            <div class="panel-body"><div class="cp-modules" data-cp-modules></div></div>
          </section>
          <section class="panel">
            <div class="panel-header"><div><span class="panel-title">Framework Notes</span><p class="cp-subtitle">Each sticky note carries pillar, competency, and mastery-level metadata.</p></div></div>
            <div class="panel-body"><div class="cp-framework" data-cp-framework></div></div>
          </section>
        </div>`;

      const planner = $("[data-cp-root]", root);
      const modulesEl = $("[data-cp-modules]", root);
      const frameworkEl = $("[data-cp-framework]", root);
      const searchInput = $("[data-cp-search]", root);
      const pillarFilter = $("[data-cp-pillar]", root);
      const statsEl = $("[data-cp-stats]", root);
      const importInput = $("[data-cp-import-file]", root);
      const pending = ns.pendingCurriculumSession || null;
      ns.pendingCurriculumSession = null;
      if (pending) {
        state = parseImportedState(pending);
        localStorage.setItem(stateKey, JSON.stringify(state));
      }

      function loadState() {
        const saved = localStorage.getItem(stateKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            const modules = normalizeModules(parsed.modulesRaw || parsed.modules);
            return { modules, assignments: normalizeAssignments(parsed.assignments || {}, modules.length), collapsedPillars: normalizeCollapsedPillars(parsed.collapsedPillars || {}) };
          } catch { localStorage.removeItem(stateKey); }
        }
        return { modules: [...defaultModules], assignments: {}, collapsedPillars: {} };
      }
      function saveState() { localStorage.setItem(stateKey, JSON.stringify(state)); updateStats(); }
      function render() { renderFilters(); renderModules(); renderFramework(); updateStats(); applyFilters(); }
      function renderFilters() { pillarFilter.innerHTML = `<option value="all">All pillars</option>${pillars.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join("")}`; }
      function renderModules() {
        modulesEl.innerHTML = "";
        state.modules.forEach((name, index) => {
          const module = document.createElement("article");
          module.className = "cp-module panel";
          module.innerHTML = `<div class="panel-header cp-module-header"><input class="text-input" value="${escapeHtml(name)}" aria-label="Module ${index + 1} title"><div class="panel-actions"><span class="cp-count" data-cp-count="${index}"></span><button class="btn btn-subtle" type="button" data-cp-remove-module="${index}" ${state.modules.length === 1 ? "disabled" : ""}>Remove</button></div></div><div class="cp-drop-zone" data-cp-module="${index}" aria-label="Drop notes into ${escapeHtml(name)}"></div>`;
          $("input", module).addEventListener("input", (event) => { state.modules[index] = event.target.value; saveState(); });
          $("[data-cp-remove-module]", module).addEventListener("click", () => removeModule(index));
          wireDropZone($("[data-cp-module]", module), (noteId) => assignNote(noteId, index));
          renderModuleNotes($("[data-cp-module]", module), index);
          modulesEl.append(module);
        });
      }
      function renderModuleNotes(zone, moduleIndex) {
        const assigned = notes.filter((note) => state.assignments[note.id] === moduleIndex);
        zone.innerHTML = assigned.length ? "" : `<div class="cp-empty">Drop framework notes here</div>`;
        assigned.forEach((note) => zone.append(createSticky(note, true)));
      }
      function renderFramework() {
        frameworkEl.innerHTML = "";
        pillars.forEach((pillar) => {
          const section = document.createElement("article");
          section.className = "cp-pillar panel";
          if (state.collapsedPillars[pillar.id]) section.classList.add("is-collapsed");
          section.dataset.pillar = pillar.id;
          section.style.setProperty("--cp-pillar-color", pillar.color);
          section.innerHTML = `<div class="panel-header cp-pillar-header"><div><span class="panel-title">${escapeHtml(pillar.title)}</span><p class="cp-subtitle">${escapeHtml(pillar.focus)}</p></div><button class="btn btn-secondary" type="button" aria-expanded="${!state.collapsedPillars[pillar.id]}" data-cp-toggle="${pillar.id}">${state.collapsedPillars[pillar.id] ? "Expand" : "Collapse"}</button></div><div class="cp-grid"><div class="cp-grid-head">Competency</div>${levels.map((level) => `<div class="cp-grid-head">${level}</div>`).join("")}</div>`;
          const grid = $(".cp-grid", section);
          $("[data-cp-toggle]", section).addEventListener("click", () => togglePillar(pillar.id));
          pillar.competencies.forEach((competency) => {
            const rowTitle = document.createElement("div");
            rowTitle.className = "cp-competency";
            rowTitle.textContent = competency.name;
            grid.append(rowTitle);
            levels.forEach((level) => {
              const note = notes.find((item) => item.pillarId === pillar.id && item.competency === competency.name && item.level === level);
              const cell = document.createElement("div");
              cell.className = "cp-framework-cell";
              cell.dataset.pillar = pillar.id;
              wireDropZone(cell, (noteId) => { if (noteId === note.id) unassignNote(noteId); });
              if (state.assignments[note.id] === undefined) cell.append(createSticky(note, false));
              else cell.innerHTML = `<div class="cp-empty">Placed in ${escapeHtml(state.modules[state.assignments[note.id]])}</div>`;
              grid.append(cell);
            });
          });
          frameworkEl.append(section);
        });
      }
      function createSticky(note, inModule) {
        const card = document.createElement("article");
        card.className = "cp-sticky";
        card.draggable = true;
        card.dataset.note = note.id;
        card.dataset.pillar = note.pillarId;
        card.dataset.search = `${note.pillarTitle} ${note.competency} ${note.level} ${note.text}`.toLowerCase();
        card.style.setProperty("--cp-note-color", noteColors[note.level]);
        card.innerHTML = `<div class="cp-note-tags"><span class="count-pill">${escapeHtml(note.pillar)}</span><span class="count-pill">${escapeHtml(note.level)}</span><span class="count-pill">${escapeHtml(note.competency)}</span></div><p>${escapeHtml(note.text)}</p>${inModule ? `<div class="cp-note-actions"><button class="count-pill cp-return-pill" type="button" data-cp-return="${note.id}">Return to grid</button></div>` : ""}`;
        card.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", note.id); event.dataTransfer.effectAllowed = "move"; });
        const returnBtn = $("[data-cp-return]", card);
        if (returnBtn) returnBtn.addEventListener("click", () => unassignNote(note.id));
        return card;
      }
      function wireDropZone(element, onDrop) {
        element.addEventListener("dragover", (event) => { event.preventDefault(); element.classList.add("is-drag-over"); });
        element.addEventListener("dragleave", () => element.classList.remove("is-drag-over"));
        element.addEventListener("drop", (event) => { event.preventDefault(); element.classList.remove("is-drag-over"); const noteId = event.dataTransfer.getData("text/plain"); if (noteId) onDrop(noteId); });
      }
      function assignNote(noteId, moduleIndex) { state.assignments[noteId] = moduleIndex; rerenderAfterMove(); }
      function unassignNote(noteId) { delete state.assignments[noteId]; rerenderAfterMove(); }
      function rerenderAfterMove() { saveState(); renderModules(); renderFramework(); applyFilters(); }
      function addModule() { state.modules.push(`Module ${state.modules.length + 1}`); rerenderAfterMove(); }
      function removeModule(moduleIndex) {
        if (state.modules.length === 1) return;
        if (!confirm(`Remove "${state.modules[moduleIndex]}"? Notes in it will return to the framework grid.`)) return;
        state.modules.splice(moduleIndex, 1);
        Object.entries(state.assignments).forEach(([noteId, assignedIndex]) => {
          if (assignedIndex === moduleIndex) delete state.assignments[noteId];
          else if (assignedIndex > moduleIndex) state.assignments[noteId] = assignedIndex - 1;
        });
        rerenderAfterMove();
      }
      function togglePillar(pillarId) { state.collapsedPillars[pillarId] = !state.collapsedPillars[pillarId]; saveState(); renderFramework(); applyFilters(); }
      function applyFilters() {
        const query = searchInput.value.trim().toLowerCase();
        const pillarId = pillarFilter.value;
        $$(".cp-pillar", planner).forEach((pillarEl) => { pillarEl.hidden = !(pillarId === "all" || pillarEl.dataset.pillar === pillarId); });
        $$(".cp-sticky", planner).forEach((card) => {
          const matchesPillar = pillarId === "all" || card.dataset.pillar === pillarId;
          const matchesSearch = !query || card.dataset.search.includes(query);
          card.hidden = !(matchesPillar && matchesSearch);
        });
      }
      function updateStats() {
        const placed = Object.keys(state.assignments).length;
        statsEl.textContent = `${placed} of ${notes.length} notes placed`;
        $$("[data-cp-count]", planner).forEach((el) => {
          const index = Number(el.dataset.cpCount);
          const count = notes.filter((note) => state.assignments[note.id] === index).length;
          el.textContent = `${count} notes`;
        });
      }
      function buildExportPayload() {
        return { version: 2, exportedAt: new Date().toISOString(), modulesRaw: state.modules, assignments: state.assignments, collapsedPillars: state.collapsedPillars, modules: state.modules.map((name, index) => ({ name, notes: notes.filter((note) => state.assignments[note.id] === index).map(({ pillarTitle, competency, level, text }) => ({ pillar: pillarTitle, competency, level, text })) })), unplaced: notes.filter((note) => state.assignments[note.id] === undefined).map(({ pillarTitle, competency, level, text }) => ({ pillar: pillarTitle, competency, level, text })) };
      }
      function saveToHistory(button) {
        const payload = buildExportPayload();
        const placedCount = Object.keys(state.assignments).length;
        const label = state.modules
          .map((name) => name.replace(/^Module\s+\d+:\s*/i, "").trim())
          .find(Boolean) || `Curriculum Plan (${state.modules.length} modules)`;
        ns.history.add({
          id: `curriculum-${Date.now()}`,
          timestamp: Date.now(),
          sourceLabel: label,
          inputType: "curriculum",
          ...payload,
          summary: { moduleCount: state.modules.length, placedCount, totalCount: notes.length }
        });
        const original = button.textContent;
        button.textContent = "Saved";
        button.classList.add("btn-success");
        setTimeout(() => { button.textContent = original; button.classList.remove("btn-success"); }, 1600);
      }
      function planJson() { return JSON.stringify(buildExportPayload(), null, 2); }
      async function copyExport(toggle) {
        const original = toggle.textContent;
        toggle.disabled = true;
        try {
          await copyText(planJson());
          toggle.textContent = "Copied";
          toggle.classList.add("btn-success");
        } finally {
          setTimeout(() => { toggle.textContent = original; toggle.classList.remove("btn-success"); toggle.disabled = false; }, 1600);
        }
      }
      function downloadExport() {
        const blob = new Blob([planJson()], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = Object.assign(document.createElement("a"), { href: url, download: `ai-ready-lawyer-curriculum-plan-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      }
      function importPlanFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          try { state = parseImportedState(JSON.parse(reader.result)); saveState(); render(); alert("Plan imported."); }
          catch (error) { alert(`Import failed: ${error.message}`); }
          finally { importInput.value = ""; }
        });
        reader.readAsText(file);
      }
      function parseImportedState(imported) {
        if (!imported || typeof imported !== "object") throw new Error("The file does not contain a saved curriculum plan.");
        const modules = normalizeModules(imported.modulesRaw || imported.modules);
        let assignments = {};
        if (imported.assignments) assignments = normalizeAssignments(imported.assignments, modules.length);
        else if (Array.isArray(imported.modules)) assignments = assignmentsFromReadableModules(imported.modules);
        return { modules, assignments: normalizeAssignments(assignments, modules.length), collapsedPillars: normalizeCollapsedPillars(imported.collapsedPillars || {}) };
      }
      function assignmentsFromReadableModules(modulePayload) {
        const assignments = {};
        modulePayload.forEach((module, moduleIndex) => {
          if (!Array.isArray(module.notes)) return;
          module.notes.forEach((candidate) => {
            const match = notes.find((note) => note.pillarTitle === candidate.pillar && note.competency === candidate.competency && note.level === candidate.level);
            if (match) assignments[match.id] = moduleIndex;
          });
        });
        return assignments;
      }
      function resetPlan() {
        if (!confirm("Reset module names and return all notes to the framework grid?")) return;
        state = { modules: [...defaultModules], assignments: {}, collapsedPillars: {} };
        saveState(); render();
      }
      function autoScrollDuringDrag(event) {
        const rootRect = root.getBoundingClientRect();
        const edgeSize = 90;
        const maxStep = 22;
        let delta = 0;
        if (event.clientY - rootRect.top < edgeSize) delta = -Math.ceil(((edgeSize - (event.clientY - rootRect.top)) / edgeSize) * maxStep);
        else if (rootRect.bottom - event.clientY < edgeSize) delta = Math.ceil(((edgeSize - (rootRect.bottom - event.clientY)) / edgeSize) * maxStep);
        if (delta !== 0) root.scrollBy({ top: delta, behavior: "auto" });
      }

      searchInput.addEventListener("input", applyFilters);
      pillarFilter.addEventListener("change", applyFilters);
      $("[data-cp-add-module]", root).addEventListener("click", addModule);
      $("[data-cp-save-history]", root).addEventListener("click", (event) => saveToHistory(event.currentTarget));
      $("[data-cp-import]", root).addEventListener("click", () => importInput.click());
      importInput.addEventListener("change", () => importPlanFile(importInput.files[0]));
      const exportToggle = $("[data-cp-export-toggle]", root);
      const exportMenu = $("[data-cp-export-menu]", root);
      exportToggle.addEventListener("click", (event) => { event.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; });
      exportMenu.addEventListener("click", (event) => {
        const button = event.target.closest("[data-cp-export]");
        if (!button) return;
        exportMenu.hidden = true;
        if (button.dataset.cpExport === "copy-json") copyExport(exportToggle);
        else downloadExport();
      });
      document.addEventListener("click", (event) => { if (!event.target.closest(".export-wrap")) exportMenu.hidden = true; });
      $("[data-cp-reset]", root).addEventListener("click", resetPlan);
      planner.addEventListener("dragover", autoScrollDuringDrag);
      render();
    }
  });

  function buildNotes() {
    return pillars.flatMap((pillar) => pillar.competencies.flatMap((competency, competencyIndex) => levels.map((level) => ({ id: `${pillar.id}-${competencyIndex}-${level.toLowerCase()}`, pillarId: pillar.id, pillar: pillar.short, pillarTitle: pillar.title, competency: competency.name, level, text: competency.notes[level] }))));
  }
  function normalizeModules(modules) {
    if (!Array.isArray(modules) || modules.length === 0) return [...defaultModules];
    return modules.map((module, index) => {
      if (typeof module === "string") return module || `Module ${index + 1}`;
      if (module && typeof module.name === "string") return module.name || `Module ${index + 1}`;
      return `Module ${index + 1}`;
    });
  }
  function normalizeAssignments(assignments, moduleCount) {
    const validNoteIds = new Set(notes.map((note) => note.id));
    return Object.fromEntries(Object.entries(assignments).map(([noteId, moduleIndex]) => [noteId, Number(moduleIndex)]).filter(([noteId, moduleIndex]) => validNoteIds.has(noteId) && Number.isInteger(moduleIndex) && moduleIndex >= 0 && moduleIndex < moduleCount));
  }
  function normalizeCollapsedPillars(collapsedPillars) {
    const validPillarIds = new Set(pillars.map((pillar) => pillar.id));
    return Object.fromEntries(Object.entries(collapsedPillars || {}).filter(([pillarId]) => validPillarIds.has(pillarId)).map(([pillarId, collapsed]) => [pillarId, Boolean(collapsed)]));
  }
})();
