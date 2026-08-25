// A real call must have produced speech before the browser silence clock starts.
// Recall has the same five-minute provider-side ceiling, so billing still stops
// if a background tab is suspended or the browser disappears entirely.
export const CALL_SILENCE_AUTO_END_MS = 5 * 60 * 1000;
export const CALL_SILENCE_WARNING_MS = 60 * 1000;

export function callSilenceRemainingMs(
  lastSpeechAt: number,
  now = Date.now()
): number | null {
  if (!Number.isFinite(lastSpeechAt) || lastSpeechAt <= 0) return null;
  return Math.max(0, CALL_SILENCE_AUTO_END_MS - Math.max(0, now - lastSpeechAt));
}
