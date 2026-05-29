(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  ns.tools = ns.tools || [];

  ns.registerTool = function registerTool(tool) {
    ns.tools.push(tool);
  };

  ns.$ = function $(selector, root) {
    return (root || document).querySelector(selector);
  };

  ns.$$ = function $$(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  };

  ns.escapeRegExp = function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  ns.escapeHtml = function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  ns.highlightMatches = function highlightMatches(value, matchedTerms) {
    if (!value) return "";
    if (!matchedTerms || !matchedTerms.length) return ns.escapeHtml(value);

    let parts = [{ text: String(value), isMatch: false }];

    for (const term of matchedTerms) {
      const re = new RegExp(`(${ns.escapeRegExp(term)})`, "gi");
      parts = parts.flatMap((part) => {
        if (part.isMatch) return [part];
        return part.text
          .split(re)
          .map((segment, index) => ({ text: segment, isMatch: index % 2 === 1 }));
      });
    }

    return parts
      .map((part) => part.isMatch
        ? `<mark>${ns.escapeHtml(part.text)}</mark>`
        : ns.escapeHtml(part.text))
      .join("");
  };
})();
