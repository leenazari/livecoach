// Splits long text into overlapping chunks for embedding.
// Overlap preserves context across chunk boundaries.
export function chunkText(
  text: string,
  chunkSize = 900,
  overlap = 150
): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= chunkSize) return clean ? [clean] : [];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);

    // Try to break on a sentence boundary near the end of the window.
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const lastStop = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! ")
      );
      if (lastStop > chunkSize * 0.5) {
        end = start + lastStop + 1;
      }
    }

    chunks.push(clean.slice(start, end).trim());
    start = end - overlap;
  }

  return chunks.filter(Boolean);
}
