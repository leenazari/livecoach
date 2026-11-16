import { GENERIC_QUALIFYING_QUESTIONS } from "./salesTemplate";

export const QUALIFYING_TITLE = "Qualifying questions";

export const DEFAULT_QUALIFYING_QUESTIONS = GENERIC_QUALIFYING_QUESTIONS;

export function qualifyingQuestionsFrom(body: string | null | undefined): string[] {
  const lines = String(body || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter((line) => line.length > 2);
  return lines.length ? lines.slice(0, 12) : [...DEFAULT_QUALIFYING_QUESTIONS];
}
