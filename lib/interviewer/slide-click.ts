export type SlideClickDecision = "ignore-current" | "ignore-repeat" | "ask" | "introduce";

export function slideClickDecision(input: {
  number: number;
  current: number;
  covered: boolean;
  lastNumber: number;
  lastAt: number;
  now: number;
}): SlideClickDecision {
  if (input.number === input.current) return "ignore-current";
  if (input.lastNumber === input.number && input.now - input.lastAt < 1500) return "ignore-repeat";
  return input.covered ? "ask" : "introduce";
}

export function slideClickSpeech(title: string, facts: string[], covered: boolean): string {
  const name = title.replace(/\s+/g, " ").trim() || "this slide";
  if (covered) return `Back to ${name}. Ask what they would like to know about it. Do not repeat the explanation.`;
  const points = facts.map((fact) => fact.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  return [`Slide: ${name}.`, ...points].join(" ");
}

// The spoken message is handed to the socket before any later work starts.
export function sendSlideClickFirst<T>(send: () => T, after: () => void): { sentMs: number; result: T } {
  const started = performance.now();
  const result = send();
  const sentMs = performance.now() - started;
  after();
  return { sentMs, result };
}
