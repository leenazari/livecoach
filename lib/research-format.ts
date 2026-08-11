export const RESEARCH_FORMAT_VERSION = 2;

// Research sources remain stored as structured evidence, but never leak into
// the briefing copy shown to Lee or fed into the plan. This also cleans legacy
// cached briefs that had a Sources section or pasted web addresses.
export function cleanResearchBackground(value: string): string {
  return String(value || "")
    .replace(/\n+\s*(?:sources?|links?)\s*:[\s\S]*$/i, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
