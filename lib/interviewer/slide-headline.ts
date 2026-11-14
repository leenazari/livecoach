import { cleanSlideText, isInternalCostLine } from "@/lib/interviewer/slide-notes";

export const SLIDE_HEADLINE_MAX = 60;

export function isGenericSlideTitle(title: string, deckTitle = ""): boolean {
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^(slide|page)\s*\d+$/i.test(text)) return true;
  if (/^#/.test(text)) return true;
  const file = deckTitle.replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (file && text.toLowerCase() === file) return true;
  return false;
}

export function clipHeadline(value: string): string {
  const clean = cleanSlideText(value).replace(/\s+/g, " ").trim();
  if (clean.length <= SLIDE_HEADLINE_MAX) return clean;
  const cut = clean.slice(0, SLIDE_HEADLINE_MAX);
  const word = cut.replace(/\s+\S*$/, "").trim();
  return (word.length >= 18 ? word : cut).slice(0, SLIDE_HEADLINE_MAX);
}

export function headlineFromNotes(input: { talkingPoints?: string; oneLine?: string; verbatim?: string | null }): string {
  const points = cleanSlideText(input.talkingPoints || "").split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  const source = points[0] || cleanSlideText(input.verbatim || "") || "";
  const headline = clipHeadline(source);
  if (!headline || isGenericSlideTitle(headline) || isInternalCostLine(headline)) return "";
  return headline;
}

export function formatDeckKnowledge(slides: Array<{ number: number; title: string; facts: string[]; prices?: string }>): string {
  return slides.map((slide) => {
    const lines = [`${slide.number}. ${slide.title || "Untitled"}`];
    for (const fact of slide.facts) {
      const clean = fact.replace(/\s+/g, " ").trim();
      if (clean) lines.push(`- ${clean}`);
    }
    if (slide.prices?.trim()) lines.push(`- Price on the page: ${slide.prices.replace(/\s+/g, " ").trim()}`);
    return lines.join("\n");
  }).join("\n\n").slice(0, 8000);
}

export function customerHeadline(title: string, deckTitle = ""): string {
  const clipped = clipHeadline(title);
  return clipped && !isGenericSlideTitle(clipped, deckTitle) ? clipped : "";
}
