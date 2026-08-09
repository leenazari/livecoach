// Presentation-safe sentence casing for CRM narrative text. It changes only
// the first lower-case letter at the start of a sentence, so names, acronyms,
// URLs and deliberate capitalisation elsewhere remain untouched.
export function capitaliseSentenceStarts(value: unknown): string {
  const text = String(value == null ? "" : value);
  if (!text) return "";

  return text.replace(
    /(^|[.!?]\s+|\n+)([\s"'“‘([{*•–—-]*)([a-z])/g,
    (_match, boundary: string, prefix: string, letter: string) =>
      `${boundary}${prefix}${letter.toUpperCase()}`
  );
}
