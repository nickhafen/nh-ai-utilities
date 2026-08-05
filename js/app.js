(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};
  const { $, escapeHtml } = ns;

  const nav = $("#tool-nav");
  const root = $("#tool-root");

  function selectedToolId() {
    const hashId = window.location.hash.replace(/^#/, "");
    return hashId || (ns.tools[0] && ns.tools[0].id);
  }

  function renderNav(activeToolId) {
    nav.innerHTML = ns.tools.map((tool) => `
      <button
        class="tool-tab"
        type="button"
        role="tab"
        aria-selected="${tool.id === activeToolId}"
        data-tool-id="${escapeHtml(tool.id)}"
        title="${escapeHtml(tool.description || tool.name)}"
      >${escapeHtml(tool.name)}</button>
    `).join("");
  }

  // Tools registered with `persist: true` render once into a container that is
  // detached (not destroyed) on navigation, so their DOM and closure state
  // survive; re-activating re-attaches the same element. `onShow` fires on
  // every activation of a persistent tool, after render on the first one.
  const persistedRoots = new Map();

  function activateTool(toolId) {
    const tool = ns.tools.find((candidate) => candidate.id === toolId) || ns.tools[0];
    if (!tool) return;

    renderNav(tool.id);
    root.innerHTML = "";
    root.dataset.activeTool = tool.id;
    document.title = `${tool.name} | AI Utilities`;
    if (tool.persist) {
      let el = persistedRoots.get(tool.id);
      const first = !el;
      if (first) {
        el = document.createElement("div");
        persistedRoots.set(tool.id, el);
      }
      root.appendChild(el);
      if (first) tool.render(el);
      if (tool.onShow) tool.onShow(el);
    } else {
      tool.render(root);
    }
  }

  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tool-id]");
    if (!button) return;

    const toolId = button.dataset.toolId;
    if (window.location.hash.replace(/^#/, "") === toolId) {
      activateTool(toolId);
      return;
    }
    window.location.hash = toolId;
  });

  window.addEventListener("hashchange", () => activateTool(selectedToolId()));
  activateTool(selectedToolId());
})();
