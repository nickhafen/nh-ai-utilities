// Image-token estimation from pixel dimensions, per each provider's published
// formula (verified against provider docs, August 2026). Standalone so new
// models can be added without touching any feature's UI logic.
//
// Claude (platform.claude.com/docs/en/docs/build-with-claude/vision):
//   One visual token per 28x28-pixel patch: ceil(w/28) * ceil(h/28).
//   Oversized images are downscaled to the largest aspect-preserving size that
//   satisfies both a long-edge limit and a visual-token limit. Standard tier
//   (most models): 1568 px / 1568 tokens. High-resolution tier (Claude 4.7+):
//   2576 px / 4784 tokens. The resize search below mirrors Anthropic's
//   published reference implementation, including round-half-to-even.
//
// GPT-4V / GPT-4o "detail: high" (developers.openai.com/api/docs/guides/images-vision):
//   Scale to fit within 2048x2048, then scale so the shortest side is at most
//   768 px, then 85 base tokens + 170 tokens per 512x512 tile.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  ns.IMAGE_TOKEN_MODELS = [
    { id: "claude",         label: "Claude (standard resolution)",        short: "Claude" },
    { id: "claude-highres", label: "Claude (high resolution, 4.7+)",      short: "Claude high-res" },
    { id: "gpt4v",          label: "GPT-4V / GPT-4o (high detail)",       short: "GPT-4V" },
  ];

  const claudePatches = (w, h) => Math.ceil(w / 28) * Math.ceil(h / 28);

  // Round half to even (banker's rounding) — the live API resolves exact .5
  // ties toward the even neighbor, so Math.round would mis-size some images.
  function roundTiesToEven(value) {
    const floor = Math.floor(value);
    if (value - floor !== 0.5) return Math.round(value);
    return floor % 2 === 0 ? floor : floor + 1;
  }

  function claudeResizedSize(width, height, maxEdge, maxTokens) {
    const fits = (w, h) =>
      Math.ceil(w / 28) * 28 <= maxEdge &&
      Math.ceil(h / 28) * 28 <= maxEdge &&
      claudePatches(w, h) <= maxTokens;

    if (fits(width, height)) return [width, height];
    if (height > width) {
      const [resizedH, resizedW] = claudeResizedSize(height, width, maxEdge, maxTokens);
      return [resizedW, resizedH];
    }
    // Binary search along the long edge for the largest size that fits.
    const aspectRatio = width / height;
    let lo = 1, hi = width;
    while (lo + 1 < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid, Math.max(roundTiesToEven(mid / aspectRatio), 1))) lo = mid;
      else hi = mid;
    }
    return [lo, Math.max(roundTiesToEven(lo / aspectRatio), 1)];
  }

  function claudeTokens(width, height, maxEdge, maxTokens) {
    const [w, h] = claudeResizedSize(width, height, maxEdge, maxTokens);
    return claudePatches(w, h);
  }

  function gpt4vTokens(width, height) {
    let w = width, h = height;
    const fitScale = Math.min(1, 2048 / Math.max(w, h));
    w *= fitScale; h *= fitScale;
    const shortScale = Math.min(1, 768 / Math.min(w, h));
    w = Math.round(w * shortScale); h = Math.round(h * shortScale);
    return 85 + 170 * Math.ceil(w / 512) * Math.ceil(h / 512);
  }

  ns.estimateImageTokens = function estimateImageTokens(width, height, model) {
    if (!(width > 0) || !(height > 0)) return 0;
    switch (model) {
      case "claude":         return claudeTokens(width, height, 1568, 1568);
      case "claude-highres": return claudeTokens(width, height, 2576, 4784);
      case "gpt4v":          return gpt4vTokens(width, height);
      default: throw new Error(`Unknown image-token model: ${model}`);
    }
  };

  // Rendering resolution assumed when a provider rasterizes a PDF page before
  // applying its image-token formula. Neither Anthropic nor OpenAI publishes
  // the DPI their PDF ingestion pipeline actually uses — 150 DPI (a common
  // default for text-legible PDF-to-image rendering) is a disclosed
  // approximation, not a verified constant.
  const PDF_RENDER_DPI = 150;

  // Estimates one PDF page's image-token cost for the given model, from the
  // page's native point dimensions (1pt = 1/72in, what pdf.js reports at
  // viewport scale 1). Reuses the same per-model formula as estimateImageTokens.
  ns.estimatePdfPageImageTokens = function estimatePdfPageImageTokens(widthPts, heightPts, model) {
    const scale = PDF_RENDER_DPI / 72;
    return ns.estimateImageTokens(widthPts * scale, heightPts * scale, model);
  };
})();
