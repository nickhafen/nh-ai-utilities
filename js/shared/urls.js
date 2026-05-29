(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/gi;
  const MARKDOWN_LINK_RE = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gi;

  function balancedCount(value, openChar, closeChar) {
    let open = 0;
    let close = 0;
    for (const char of value) {
      if (char === openChar) open += 1;
      if (char === closeChar) close += 1;
    }
    return { open, close };
  }

  function stripTrailingUrlPunctuation(value) {
    let url = value;

    while (/[.,;:!?]/.test(url.slice(-1))) {
      url = url.slice(0, -1);
    }

    const pairs = [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
      ["<", ">"],
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const [openChar, closeChar] of pairs) {
        if (!url.endsWith(closeChar)) continue;
        const counts = balancedCount(url, openChar, closeChar);
        if (counts.close > counts.open) {
          url = url.slice(0, -1);
          changed = true;
        }
      }
    }

    return url;
  }

  function unwrapKnownRedirect(parsed) {
    const host = parsed.hostname.toLowerCase();

    if ((host === "google.com" || host.endsWith(".google.com")) && parsed.pathname === "/url") {
      return parsed.searchParams.get("q") || parsed.searchParams.get("url") || "";
    }

    if (host.endsWith(".safelinks.protection.outlook.com")) {
      return parsed.searchParams.get("url") || "";
    }

    return "";
  }

  ns.cleanUrl = function cleanUrl(value) {
    let url = String(value || "")
      .trim()
      .replace(/&amp;/gi, "&")
      .replace(/&nbsp;/gi, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "");

    url = url.replace(/^[\s"'([{<]+/, "");
    url = stripTrailingUrlPunctuation(url);

    if (/^www\./i.test(url)) {
      url = `https://${url}`;
    }

    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      const unwrapped = unwrapKnownRedirect(parsed);
      if (unwrapped && /^https?:\/\//i.test(unwrapped)) {
        return ns.cleanUrl(unwrapped);
      }
      parsed.hash = parsed.hash;
      return parsed.href;
    } catch {
      return "";
    }
  };

  ns.extractUrls = function extractUrls(text) {
    const candidates = [];
    const source = String(text || "");

    for (const match of source.matchAll(HREF_RE)) {
      candidates.push(match[1]);
    }

    for (const match of source.matchAll(MARKDOWN_LINK_RE)) {
      candidates.push(match[1]);
    }

    for (const match of source.matchAll(URL_RE)) {
      candidates.push(match[0]);
    }

    const urls = [];
    const seen = new Set();

    for (const candidate of candidates) {
      const url = ns.cleanUrl(candidate);
      if (!url) continue;

      const key = url.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      urls.push(url);
    }

    return urls;
  };

  ns.formatUrls = function formatUrls(urls, format) {
    if (format === "commas") return urls.join(", ");
    return urls.join("\n");
  };
})();
