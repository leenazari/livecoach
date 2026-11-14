// Conversation silence is separate from the slot heartbeat. The slot sends a
// heartbeat every 15 seconds and is only released after 45 seconds without
// one. These timers must keep running while the lead is quiet, muted, or
// asking us to wait. A polite ending calls the normal end path.

export const SILENCE_CHECK_MS = 30_000;
export const SILENCE_WARN_MS = 20_000;
export const SILENCE_END_MS = 15_000;
export const HOLD_CHECK_MS = 3 * 60_000;
export const HOLD_WARN_MS = 5 * 60_000;
export const MUTE_CHECK_MS = 4 * 60_000;
export const MUTE_END_MS = 5 * 60_000;
export const NOISE_REPEAT_MS = 3 * 60_000;

const HOLD_PHRASES = [
  "wait a minute",
  "wait a second",
  "wait a sec",
  "hold on",
  "one sec",
  "one second",
  "let me check",
  "let me just check",
  "hang on",
  "give me a minute",
  "give me a second",
  "let me ask",
  "i'll ask",
  "let me talk",
  "i'm conferring",
  "let me confer",
];

export function isHoldRequest(text: string): boolean {
  const normalised = text.toLowerCase().replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ");
  return HOLD_PHRASES.some((phrase) => normalised.includes(phrase));
}

export type SilencePhase = "clear" | "checked" | "warned" | "holding" | "hold-checked";

export type SilenceSnapshot = {
  now: number;
  lastActivityAt: number;
  lastSpeaker: "agent" | "lead";
  phase: SilencePhase;
  holdSince: number | null;
  muted: boolean;
  mutedSince: number | null;
  muteChecked: boolean;
  speaking: boolean;
};

export type SilenceCue = "none" | "check" | "warn" | "end" | "hold-check" | "mute-check" | "mute-end";

export function nextSilenceCue(input: SilenceSnapshot): SilenceCue {
  if (input.speaking) return "none";
  if (input.muted) {
    if (input.mutedSince == null) return "none";
    const quiet = input.now - input.mutedSince;
    if (quiet >= MUTE_END_MS) return "mute-end";
    if (quiet >= MUTE_CHECK_MS && !input.muteChecked) return "mute-check";
    return "none";
  }
  if (input.holdSince != null) {
    const held = input.now - input.holdSince;
    if (input.phase === "warned" && held >= HOLD_WARN_MS + SILENCE_END_MS) return "end";
    if (held >= HOLD_WARN_MS && input.phase !== "warned") return "warn";
    if (held >= HOLD_CHECK_MS && input.phase === "holding") return "hold-check";
    return "none";
  }
  if (input.lastSpeaker !== "agent") return "none";
  const silent = input.now - input.lastActivityAt;
  if (input.phase === "warned" && silent >= SILENCE_END_MS) return "end";
  if (input.phase === "checked" && silent >= SILENCE_WARN_MS) return "warn";
  if (input.phase === "clear" && silent >= SILENCE_CHECK_MS) return "check";
  return "none";
}
