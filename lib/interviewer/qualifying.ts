export const QUALIFYING_TITLE = "Qualifying questions";

export const DEFAULT_QUALIFYING_QUESTIONS = [
  "Where are you based?",
  "What type of business is it?",
  "How many sites or tills do you have?",
  "What are you using today?",
  "How do customers order today? At the counter, at the table, by phone, online, or through a delivery app?",
  "How are orders taken and sent to the kitchen?",
  "How do customers pay?",
  "When are you busiest, and where do queues or wait times stretch the team?",
  "When are you looking to move on this?",
];

export function qualifyingQuestionsFrom(body: string | null | undefined): string[] {
  const lines = String(body || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter((line) => line.length > 2);
  return lines.length ? lines.slice(0, 12) : [...DEFAULT_QUALIFYING_QUESTIONS];
}
