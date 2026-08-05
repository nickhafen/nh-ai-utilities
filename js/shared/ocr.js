// Shared OCR module built on tesseract.js. Standalone and decoupled from any
// feature so it can serve both the Screenshot pipeline (today) and a future
// PDF scanned-page fallback without rework. Lazily loaded from CDN — the
// library plus its worker/language data is several MB, so nothing is fetched
// until the first OCR call.
(function () {
  const ns = window.AiUtilities = window.AiUtilities || {};

  let _tesseractPromise;
  function loadTesseract() {
    if (!_tesseractPromise) {
      _tesseractPromise = new Promise((resolve, reject) => {
        if (window.Tesseract) return resolve(window.Tesseract);
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
        script.onload = () => resolve(window.Tesseract);
        script.onerror = () => reject(new Error("Failed to load the OCR library (tesseract.js) from CDN."));
        document.head.appendChild(script);
      });
    }
    return _tesseractPromise;
  }

  // Full OCR result: raw text plus per-line geometry (bbox height is a font
  // size proxy used for heading heuristics). onProgress receives 0..1.
  ns.ocrImage = async function ocrImage(imageSource, onProgress) {
    const Tesseract = await loadTesseract();
    const { data } = await Tesseract.recognize(imageSource, "eng", {
      logger: (m) => {
        if (onProgress && m.status === "recognizing text") onProgress(m.progress || 0);
      },
    });
    const lines = (data.lines || []).map((line) => ({
      text: (line.text || "").replace(/\s+$/, ""),
      height: line.bbox ? line.bbox.y1 - line.bbox.y0 : 0,
      confidence: line.confidence,
    }));
    return { text: data.text || "", lines };
  };

  // Simple text-only entry point: image → raw OCR text.
  ns.ocrImageToText = async function ocrImageToText(imageSource) {
    return (await ns.ocrImage(imageSource)).text;
  };
})();
