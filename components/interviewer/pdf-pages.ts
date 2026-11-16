const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 40;

export type RenderedPage = { image: Blob; text: string };

function linesFromItems(items: Array<{ str?: string; transform?: number[] }>): string {
  const rows: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = [];
  for (const item of items) {
    const str = String(item.str || "").replace(/\s+/g, " ").trim();
    if (!str || !item.transform) continue;
    const y = item.transform[5] || 0;
    const row = rows.find((entry) => Math.abs(entry.y - y) < 3);
    if (row) row.parts.push({ x: item.transform[4] || 0, str });
    else rows.push({ y, parts: [{ x: item.transform[4] || 0, str }] });
  }
  rows.sort((left, right) => right.y - left.y);
  return rows.map((row) => row.parts.sort((left, right) => left.x - right.x).map((part) => part.str).join(" ")).filter(Boolean).join("\n");
}

export async function textFromPdf(file: File): Promise<string> {
  if (file.size > MAX_PDF_BYTES) throw new Error("That PDF is over 50 MB. Export a smaller file and try again.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/interviewer/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const limit = Math.min(pdf.numPages, 6);
  for (let number = 1; number <= limit; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    pages.push(linesFromItems(content.items as Array<{ str?: string; transform?: number[] }>));
  }
  return pages.filter(Boolean).join("\n");
}

export async function renderPdfPages(
  file: File,
  onPage?: (page: number, total: number) => void,
): Promise<RenderedPage[]> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error("That PDF is over 50 MB. Export a smaller file and try again.");
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) {
    throw new Error("PowerPoint is not converted here. Export the deck as a PDF, then upload that.");
  }
  if (!lower.endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Upload a PDF.");
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/interviewer/pdf.worker.min.mjs";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  if (pdf.numPages > MAX_PAGES) {
    throw new Error(`That PDF has ${pdf.numPages} pages. The limit is ${MAX_PAGES}.`);
  }
  const pages: RenderedPage[] = [];
  onPage?.(0, pdf.numPages);
  for (let number = 1; number <= pdf.numPages; number += 1) {
    onPage?.(number, pdf.numPages);
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1400 / base.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not draw that page.");
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("A page could not be saved as an image."))), "image/png");
    });
    const content = await page.getTextContent();
    const text = linesFromItems(content.items as Array<{ str?: string; transform?: number[] }>);
    pages.push({ image: blob, text });
  }
  return pages;
}

export async function putSlideImages(
  uploads: Array<{ slideNumber: number; signedUrl: string; contentType?: string }>,
  pages: RenderedPage[],
  onPage?: (page: number, total: number) => void,
): Promise<void> {
  const ordered = uploads.slice().sort((left, right) => left.slideNumber - right.slideNumber);
  let done = 0;
  for (const upload of ordered) {
    done += 1;
    onPage?.(done, ordered.length);
    const page = pages[upload.slideNumber - 1]?.image;
    if (!page) throw new Error(`Page ${upload.slideNumber} was not rendered.`);
    const response = await fetch(upload.signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": upload.contentType || "image/png",
        "x-upsert": "true",
      },
      body: page,
    });
    if (!response.ok) throw new Error(`Slide ${upload.slideNumber} did not upload.`);
  }
}
