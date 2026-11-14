// Customer-facing lines may say "lower cost" as a benefit. Only internal
// supplier, margin, and our-own-cost lines are removed before they reach the agent.

const SUPPLIER = /\b(tavus|deepgram|elevenlabs|openai|cartesia|margins?)\b/i;
const INTERNAL_COST = /\b(internal cost|our cost|supplier cost|cost rate|cost per|api cost|token cost|unit cost)\b/i;

export function isInternalCostLine(line: string): boolean {
  return SUPPLIER.test(line) || INTERNAL_COST.test(line);
}

export function cleanSlideText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isInternalCostLine(line))
    .join("\n")
    .trim();
}
