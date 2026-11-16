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

const STOP = new Set(["your", "with", "from", "that", "this", "they", "their", "about", "show", "when", "slide", "into", "every", "where", "what", "have", "been", "will", "just", "also", "more", "than", "then", "them", "only", "over", "under", "after", "before", "which", "while", "there", "here", "make", "made", "using", "used", "customers", "customer", "orders", "order", "venue"]);

export function keywordsFor(input: { title?: string | null; oneLine?: string | null; talkingPoints?: string | null }): string[] {
  const title = String(input.title || "");
  const points = String(input.talkingPoints || "");
  const bag = `${title} ${input.oneLine || ""} ${points}`;
  const keys = new Set<string>();
  const heading = title.split(":")[0].toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (heading.length > 8) keys.add(heading);
  addWords(keys, heading, 4);
  addWords(keys, points.toLowerCase(), 7);
  for (const [pattern, words] of ALIASES) {
    if (pattern.test(bag)) words.forEach((word) => keys.add(word));
  }
  return [...keys];
}

function addWords(keys: Set<string>, text: string, min: number) {
  for (const word of text.split(/[^a-z0-9]+/)) {
    if (word.length >= min && !STOP.has(word)) keys.add(word);
  }
}

function titleStrength(title: string, key: string): boolean {
  const heading = title.toLowerCase();
  if (heading.includes(key)) return true;
  return ALIASES.some(([pattern, words]) => pattern.test(title) && words.includes(key));
}

export function matchSpokenSlide(speech: string, slides: SlideKeywords[], current: number): number | null {
  const hay = speech.toLowerCase();
  let best: { number: number; score: number } | null = null;
  for (const slide of slides) {
    let score = 0;
    for (const key of slide.keywords || []) {
      if (!key || !hay.includes(key)) continue;
      score += titleStrength(slide.title || "", key) ? key.length * 5 : key.length;
    }
    if (!best || score > best.score) best = { number: slide.number, score };
  }
  if (!best || best.score < 5 || best.number === current) return null;
  return best.number;
}

// A discovery sentence that merely mentions a word should not change the picture.
// A question, a request, or a short reply should.
export function leadRequestsTopic(text: string): boolean {
  const value = String(text || "").trim();
  if (!value) return false;
  if (/[?]/.test(value)) return true;
  if (/\b(what|how|why|show me|tell me|do you|can you|can i|have you|options)\b/i.test(value)) return true;
  const words = value.replace(/[^a-z0-9 ]/gi, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6;
}
