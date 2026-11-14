export type SlideKeywords = { number: number; title?: string; keywords: string[] };

const ALIASES: Array<[RegExp, string[]]> = [
  [/kitchen display|\bkds\b|kitchen screen/i, ["kitchen display", "kds", "kitchen screen"]],
  [/kiosk|self-service|self service/i, ["kiosk", "self-service", "self service"]],
  [/waiter mate|handheld/i, ["waiter mate", "handheld"]],
  [/loyalty/i, ["loyalty"]],
  [/tipping|\btips\b/i, ["tipping"]],
  [/booking/i, ["booking", "bookings"]],
  [/mobile order/i, ["mobile ordering", "mobile order"]],
];

export function keywordsFor(input: { title?: string | null; oneLine?: string | null; talkingPoints?: string | null }): string[] {
  const bag = `${input.title || ""} ${input.oneLine || ""} ${input.talkingPoints || ""}`;
  const keys = new Set<string>();
  const title = String(input.title || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (title.length > 8) keys.add(title);
  for (const [pattern, words] of ALIASES) {
    if (pattern.test(bag)) words.forEach((word) => keys.add(word));
  }
  return [...keys];
}

export function matchSpokenSlide(speech: string, slides: SlideKeywords[], current: number): number | null {
  const hay = speech.toLowerCase();
  let best: { number: number; score: number } | null = null;
  for (const slide of slides) {
    let score = 0;
    for (const key of slide.keywords || []) {
      if (key && hay.includes(key)) score += key.length;
    }
    if (!best || score > best.score) best = { number: slide.number, score };
  }
  if (!best || best.score < 3 || best.number === current) return null;
  return best.number;
}
