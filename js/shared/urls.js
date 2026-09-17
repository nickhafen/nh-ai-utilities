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

  // True for an href that needs a base URL to mean anything: no scheme
  // ("2024/report.pdf", "/en/page.asp", "//host/x"), and not a same-page
  // anchor or a bare "www." address (cleanUrl already handles those).
  // Anything starting with a backslash (UNC paths like \\host\share) is
  // rejected outright.
  ns.isRelativeHref = function isRelativeHref(value) {
    const href = String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "");
    if (!href || href.startsWith("#") || href.startsWith("\\") || /^www\./i.test(href)) return false;
    return !/^[a-z][a-z0-9+.-]*:/i.test(href);
  };

  // Resolves a (possibly relative) href against a base URL, then applies the
  // same cleanup as cleanUrl (so only http/https results come back). Returns
  // "" when either part is unusable. cleanUrl itself stays base-less, so the
  // other workflows keep receiving only links that were absolute to begin with.
  ns.resolveUrl = function resolveUrl(href, base) {
    const raw = String(href || "").trim().replace(/[\u0000-\u001f\u007f]/g, "");
    if (!raw) return "";
    if (!ns.isRelativeHref(raw)) return ns.cleanUrl(raw);
    const cleanBase = ns.cleanUrl(base);
    if (!cleanBase) return "";
    try {
      return ns.cleanUrl(new URL(raw, cleanBase).href);
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
