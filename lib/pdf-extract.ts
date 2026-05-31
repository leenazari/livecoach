import { extractText, getDocumentProxy } from "unpdf";

// Serverless-safe PDF text extraction.
// unpdf ships its own PDF.js build for serverless (no worker, no DOM,
// no memory blowup) — built specifically for environments like Vercel.
export async function extractTextFromPDF(
  data: Uint8Array | Buffer | ArrayBuffer
): Promise<string> {
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else bytes = new Uint8Array(data); // Buffer

  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}
