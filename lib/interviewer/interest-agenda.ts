export type AgendaItem = { id: string; label: string; covered: boolean };

const INTERESTS: Array<{ id: string; label: string; keywords: string[] }> = [
  { id: "payments", label: "card payments", keywords: ["card terminal", "card payment", "integrated card"] },
  { id: "handheld", label: "handhelds", keywords: ["handheld", "waiter mate", "waitermate"] },
  { id: "kds", label: "kitchen display", keywords: ["kitchen display", "kds", "kitchen screen"] },
  { id: "kiosk", label: "kiosks", keywords: ["kiosk", "self-service", "self service"] },
  { id: "online", label: "online ordering", keywords: ["online order", "mobile order", "phone order"] },
  { id: "loyalty", label: "loyalty", keywords: ["loyalty"] },
];

function earliest(hay: string, keywords: string[]): number {
  let at = -1;
  for (const key of keywords) {
    const index = hay.indexOf(key);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  return at;
}

export function noteInterests(text: string, agenda: AgendaItem[]): AgendaItem[] {
  const hay = text.toLowerCase();
  const found: Array<{ id: string; label: string; at: number }> = [];
  for (const interest of INTERESTS) {
    if (agenda.some((item) => item.id === interest.id)) continue;
    const at = earliest(hay, interest.keywords);
    if (at >= 0) found.push({ id: interest.id, label: interest.label, at });
  }
  found.sort((left, right) => left.at - right.at);
  return [...agenda, ...found.map((item) => ({ id: item.id, label: item.label, covered: false }))];
}

export function coverInterests(text: string, agenda: AgendaItem[]): AgendaItem[] {
  if (/^you also mentioned\b|^still to cover\b/i.test(text.trim())) return agenda;
  const hay = text.toLowerCase();
  return agenda.map((item) => {
    if (item.covered) return item;
    const interest = INTERESTS.find((entry) => entry.id === item.id);
    return interest && earliest(hay, interest.keywords) >= 0 ? { ...item, covered: true } : item;
  });
}

export function agendaFromLines(lines: Array<{ speaker: string; text: string }>): AgendaItem[] {
  return lines.reduce<AgendaItem[]>((agenda, line) => {
    return line.speaker === "lead" ? noteInterests(line.text, agenda) : coverInterests(line.text, agenda);
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
