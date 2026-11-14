const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 40;

export async function renderPdfPages(file: File): Promise<Blob[]> {
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
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  if (pdf.numPages > MAX_PAGES) {
    throw new Error(`That PDF has ${pdf.numPages} pages. The limit is ${MAX_PAGES}.`);
  }
  const pages: Blob[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
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
    pages.push(blob);
  }
  return pages;
}

export async function putSlideImages(
  uploads: Array<{ slideNumber: number; signedUrl: string; contentType?: string }>,
  pages: Blob[],
): Promise<void> {
  for (const upload of uploads) {
    const page = pages[upload.slideNumber - 1];
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
