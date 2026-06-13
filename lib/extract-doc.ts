"use client";

// Browser-side document text extraction. Turns any uploaded file into plain
// text BEFORE it leaves the browser, so the giant binary never hits the upload
// limit. PDFs use pdf.js for embedded text; if a PDF is image-based (a scanned
// or design-heavy deck), it falls back to OCR (tesseract.js). Word docs use
// mammoth. Libraries load from CDN at runtime, so there's no package.json change.

type ExtractProgress = (msg: string) => void;

const PDFJS =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const TESSERACT =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const MAMMOTH =
  "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";

const scriptPromises: Record<string, Promise<void>> = {};

function loadScript(src: string, globalName: string): Promise<void> {
  if (typeof window !== "undefined" && (window as any)[globalName]) {
    return Promise.resolve();
  }
  if (scriptPromises[src]) return scriptPromises[src];
  scriptPromises[src] = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  return scriptPromises[src];
}

export async function extractDocText(
  file: File,
  onProgress?: ExtractProgress
): Promise<string> {
  const say = (m: string) => onProgress && onProgress(m);
  const name = file.name.toLowerCase();

  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    file.type.startsWith("text/")
  ) {
    return (await file.text()).trim();
  }

  if (name.endsWith(".docx")) {
    say("reading document…");
    await loadScript(MAMMOTH, "mammoth");
    const mammoth = (window as any).mammoth;
    const arrayBuffer = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer });
    return String(res?.value || "").trim();
  }

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return await extractPdf(file, say);
  }

  // Last resort: try to read it as text.
  try {
    return (await file.text()).trim();
  } catch {
    return "";
  }
}

async function extractPdf(file: File, say: ExtractProgress): Promise<string> {
  await loadScript(PDFJS, "pdfjsLib");
  const pdfjsLib = (window as any).pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const n = pdf.numPages;

  let text = "";
  for (let i = 1; i <= n; i++) {
    say(`reading page ${i} of ${n}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it: any) => it.str || "").join(" ") + "\n";
  }
  text = text.trim();

  // Sparse embedded text for the page count = an image/scanned PDF -> OCR it.
  const sparse = text.length < n * 100;
  if (!sparse) return text;

  say("looks like a scanned/image PDF - running OCR (this can take a moment)…");
  await loadScript(TESSERACT, "Tesseract");
  const Tesseract = (window as any).Tesseract;

  let ocr = "";
  for (let i = 1; i <= n; i++) {
    say(`reading images, page ${i} of ${n}…`);
    try {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const result = await Tesseract.recognize(canvas, "eng");
      ocr += String(result?.data?.text || "") + "\n";
    } catch {
      /* skip a page that fails rather than abort the whole doc */
    }
  }
  ocr = ocr.trim();

  // Keep whichever recovered more usable content.
  return ocr.length > text.length ? ocr : text;
}
