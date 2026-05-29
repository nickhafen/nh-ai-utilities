(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  // Extract all hyperlinks and plain-text URLs from a .docx JSZip object.
  // Returns { visibleText, url }[] deduplicated by URL.
  ns.extractDocxLinks = async function (zip) {
    const seen = new Set();
    const links = [];

    function add(visibleText, url) {
      const clean = ns.cleanUrl(url);
      if (!clean || clean.startsWith("#") || seen.has(clean)) return;
      seen.add(clean);
      links.push({ visibleText: visibleText.trim(), url: clean });
    }

    for (const [relsPath, relsEntry] of Object.entries(zip.files)) {
      if (relsEntry.dir || !relsPath.endsWith(".rels")) continue;

      const relsMatch = relsPath.match(/^(.*)\/_rels\/(.+)\.rels$/);
      if (!relsMatch) continue;

      const xmlPath = `${relsMatch[1]}/${relsMatch[2]}`;
      const xmlEntry = zip.files[xmlPath];
      if (!xmlEntry) continue;

      let relsText, xmlText;
      try {
        relsText = (await relsEntry.async("string")).replace(/&amp;/g, "&");
        xmlText  = (await xmlEntry.async("string")).replace(/&amp;/g, "&");
      } catch { continue; }

      // Build rId → url map from relationship file
      const urlMap = {};
      for (const rel of relsText.match(/<Relationship\b[^>]*>/g) || []) {
        const type   = (rel.match(/Type="([^"]+)"/)   || [])[1] || "";
        const id     = (rel.match(/\bId="([^"]+)"/)   || [])[1];
        const target = (rel.match(/Target="([^"]+)"/) || [])[1];
        if (type.endsWith("/hyperlink") && id && target) urlMap[id] = target;
      }

      // Pass 1: structured hyperlinks from XML
      if (Object.keys(urlMap).length) {
        for (const m of xmlText.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)) {
          const rIdMatch = m[1].match(/r:id="([^"]+)"/) || m[1].match(/\w+:id="(rId[^"]+)"/);
          const url = rIdMatch && urlMap[rIdMatch[1]] ? urlMap[rIdMatch[1]] : "";
          if (!url || url.startsWith("#")) continue;
          const visibleText = [...m[2].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
            .map(t => t[1]).join("");
          add(visibleText || url, url);
        }
      }

      // Pass 2: plain-text URLs in non-hyperlink paragraphs
      const stripped = xmlText.replace(/<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/g, "");
      for (const m of stripped.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) {
        for (const url of ns.extractUrls(m[1])) add(url, url);
      }
    }

    return links;
  };
})();
