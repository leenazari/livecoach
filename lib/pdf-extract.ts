import * as pdfjsLib from "pdfjs-dist";

// Point to the worker file from CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str || "")
        .join(" ");
      text += pageText + "\n";
    }

    return text;
  } catch (err: any) {
    throw new Error(`PDF extraction failed: ${err.message}`);
  }
}
