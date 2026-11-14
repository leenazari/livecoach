export const CALL_LIMIT_CAP_MINUTES = 30;
export const CALL_WARNING_SECONDS = 120;

export function effectiveCallMinutes(stored: number | null | undefined): number {
  const value = Number(stored);
  if (!Number.isInteger(value) || value < 1) return CALL_LIMIT_CAP_MINUTES;
  return Math.min(value, CALL_LIMIT_CAP_MINUTES);
}

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

export function twoMinuteLine(booked: boolean): string {
  return booked
    ? "I only have around two minutes left on this call. Is there anything important you'd still like to know?"
    : "I only have around two minutes left on this call. Is there anything important you'd still like to know, or shall I book you in for a demo?";
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
