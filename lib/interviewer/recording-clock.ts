export function recordingOffsetSeconds(eventAt: string, anchorAt: string): number {
  const delta = (Date.parse(eventAt) - Date.parse(anchorAt)) / 1000;
  if (!Number.isFinite(delta)) return 0;
  return Math.max(0, Math.round(delta));
}

export function formatCallLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

export function seekSecond(atSeconds: number, leadSpeech: boolean): number {
  const start = leadSpeech ? atSeconds - 2 : atSeconds;
  return Math.max(0, start);
}

export function slideTrigger(reason: string | null | undefined): "lead" | "auto" | "agent" {
  const text = String(reason || "").toLowerCase();
  if (/lead clicked|clicked the slide/.test(text)) return "lead";
  if (/\bauto\b/.test(text)) return "auto";
  return "agent";
}
