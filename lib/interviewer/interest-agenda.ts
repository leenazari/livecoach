export type AgendaItem = { id: string; label: string; covered: boolean };
export type InterestDef = { id: string; label: string; keywords: string[] };

const STOP = new Set(["your", "with", "the", "and", "for", "every", "from", "this", "that", "into", "they", "them", "about", "their", "show", "slide"]);

export function catalogFromSlides(slides: Array<{ number: number; title?: string | null; keywords?: string[] }>): InterestDef[] {
  return slides.flatMap((slide) => {
    const title = String(slide.title || "").replace(/\s+/g, " ").trim();
    if (title.length < 8 || /^slide\s+\d+$/i.test(title)) return [];
    const phrase = title.split(":")[0].toLowerCase().trim();
    const words = phrase.split(/[^a-z0-9]+/).filter((word) => word.length > 7 && !STOP.has(word));
    const keywords = [...new Set([phrase, ...words, ...(slide.keywords || []).map((key) => key.toLowerCase())])].filter((key) => key.length > 3);
    if (!keywords.length) return [];
    return [{ id: `slide-${slide.number}`, label: phrase, keywords }];
  });
}

function wordHit(hay: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:s|es)?(?=$|[^a-z0-9])`, "i").test(hay);
}

function matches(hay: string, keywords: string[]): boolean {
  const phrases = keywords.filter((key) => key.includes(" ") && key.length > 8);
  if (phrases.some((phrase) => hay.includes(phrase))) return true;
  const words = keywords.filter((key) => !key.includes(" ") && key.length > 3 && !STOP.has(key));
  return words.some((word) => wordHit(hay, word));
}

function earliest(hay: string, keywords: string[]): number {
  let at = -1;
  for (const key of keywords) {
    if (!matches(hay, [key])) continue;
    const index = hay.indexOf(key);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  return at;
}

export function noteInterests(text: string, agenda: AgendaItem[], catalog: InterestDef[] = []): AgendaItem[] {
  const hay = text.toLowerCase();
  const found: Array<{ id: string; label: string; at: number }> = [];
  for (const interest of catalog) {
    if (agenda.some((item) => item.id === interest.id)) continue;
    const at = earliest(hay, interest.keywords);
    if (at >= 0) found.push({ id: interest.id, label: interest.label, at });
  }
  found.sort((left, right) => left.at - right.at);
  return [...agenda, ...found.map((item) => ({ id: item.id, label: item.label, covered: false }))];
}

export function coverInterests(text: string, agenda: AgendaItem[], catalog: InterestDef[] = []): AgendaItem[] {
  if (/^you also mentioned\b|^still to cover\b|^note for you only\b/i.test(text.trim())) return agenda;
  const hay = text.toLowerCase();
  return agenda.map((item) => {
    if (item.covered) return item;
    const interest = catalog.find((entry) => entry.id === item.id);
    return interest && earliest(hay, interest.keywords) >= 0 ? { ...item, covered: true } : item;
  });
}

export function agendaFromLines(lines: Array<{ speaker: string; text: string }>, catalog: InterestDef[] = []): AgendaItem[] {
  return lines.reduce<AgendaItem[]>((agenda, line) => {
    return line.speaker === "lead" ? noteInterests(line.text, agenda, catalog) : coverInterests(line.text, agenda, catalog);
  }, []);
}

export function outstanding(agenda: AgendaItem[]): AgendaItem[] {
  return agenda.filter((item) => !item.covered);
}

export function bridgeLine(agenda: AgendaItem[]): string | null {
  const next = outstanding(agenda)[0];
  if (!next) return null;
  return `You also mentioned ${next.label}. Let me show you that.`;
}

export function stillToCover(agenda: AgendaItem[]): string | null {
  const left = outstanding(agenda);
  if (!left.length) return null;
  return `Still to cover: ${left.map((item) => item.label).join(", ")}`;
}

// Spoken to the lead. Never includes the internal "Still to cover" label.
export function spokenReminder(agenda: AgendaItem[], followOn = ""): string {
  return [bridgeLine(agenda), followOn].filter(Boolean).join(" ");
}

// Sent as a prompt note. The agent must not read this aloud.
export function privateCoverNote(agenda: AgendaItem[]): string | null {
  const left = stillToCover(agenda);
  const next = outstanding(agenda)[0];
  if (!left || !next) return null;
  return `Note for you only. Do not read this note aloud, and do not say "still to cover". ${left}. Say one new sentence about the next item, then show it. Do not repeat a sentence you already said.`;
}
