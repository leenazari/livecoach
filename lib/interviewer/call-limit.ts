export const CALL_LIMIT_CAP_MINUTES = 30;
export const CALL_WARNING_SECONDS = 120;

export function effectiveCallMinutes(stored: number | null | undefined): number {
  const value = Number(stored);
  if (!Number.isInteger(value) || value < 1) return CALL_LIMIT_CAP_MINUTES;
  return Math.min(value, CALL_LIMIT_CAP_MINUTES);
}

// A shorter cap for a test campaign only. It never lengthens a call, and it
// is ignored unless the campaign name itself says "test", so a live campaign
// keeps its saved limit even if the link carries the query.
export function cappedCallMinutes(stored: number | null | undefined, requested: unknown, campaignName: string): number {
  const base = effectiveCallMinutes(stored);
  const raw = typeof requested === "string" ? requested.trim() : requested;
  const asked = typeof raw === "number" || (typeof raw === "string" && raw) ? Number(raw) : NaN;
  if (!Number.isInteger(asked) || asked < 1 || asked >= base) return base;
  if (!/\btest\b/i.test(String(campaignName || ""))) return base;
  return asked;
}

// Speak the warning once the last two minutes have started, including when a
// throttled timer jumps straight to zero. A warning that was already heard
// is not repeated.
export function shouldSpeakTimeWarning(remainingSeconds: number, alreadyHeard: boolean): boolean {
  return !alreadyHeard && remainingSeconds <= CALL_WARNING_SECONDS;
}

// Deepgram refuses InjectAgentMessage behavior "default" while either side
// is mid-turn (InjectionRefused). The warning has to interrupt or it is dropped.
export const TIME_WARNING_INJECT = "interrupt" as const;

export function callEndsAt(connectedAt: string | number, minutes: number): number {
  const start = typeof connectedAt === "number" ? connectedAt : Date.parse(connectedAt);
  return start + effectiveCallMinutes(minutes) * 60 * 1000;
}

export function remainingCallSeconds(endsAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export const HUMAN_TEAM_OFFER = "Before you go, would it help to book a call with one of our human team? They can walk you through the real system and get you set up with a trial on the call.";

export function twoMinuteLine(booked: boolean): string {
  return booked
    ? "I only have around two minutes left on this call. Is there anything important you'd still like to know?"
    : `I only have around two minutes left on this call. Is there anything important you'd still like to know? ${HUMAN_TEAM_OFFER}`;
}

export const TIME_LIMIT_GOODBYE = "That's the end of our time. Thank you for talking with me. Take care.";

export function timeLimitChapters(durationSeconds: number, limitSeconds: number): Array<{ label: string; kind: "warning" | "limit"; atSeconds: number }> {
  const chapters: Array<{ label: string; kind: "warning" | "limit"; atSeconds: number }> = [];
  if (durationSeconds >= limitSeconds - CALL_WARNING_SECONDS) {
    chapters.push({ label: "Two minute warning", kind: "warning", atSeconds: Math.max(0, limitSeconds - CALL_WARNING_SECONDS) });
  }
  if (durationSeconds >= limitSeconds - 5) {
    chapters.push({ label: "Time limit", kind: "limit", atSeconds: limitSeconds });
  }
  return chapters;
}
