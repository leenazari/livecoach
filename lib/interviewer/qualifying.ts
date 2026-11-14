export const QUALIFYING_TITLE = "Qualifying questions";

export const DEFAULT_QUALIFYING_QUESTIONS = [
  "Where are you based?",
  "What type of business is it?",
  "How many sites or tills do you have?",
  "What are you using today?",
  "When are you looking to move on this?",
];

export function qualifyingQuestionsFrom(body: string | null | undefined): string[] {
  const lines = String(body || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter((line) => line.length > 2);
  return lines.length ? lines.slice(0, 8) : [...DEFAULT_QUALIFYING_QUESTIONS];
}
