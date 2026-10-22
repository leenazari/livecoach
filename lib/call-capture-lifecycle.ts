export type CallCaptureState = {
  terminal: boolean;
  startedAt: string | null;
  endedAt: string | null;
  message: string;
};

// A manual Start before a calendar meeting needs the same admission runway as
// an automatic Start. Google Meet caps the waiting-room timeout at ten minutes.
export function captureAdmissionTimeouts(meetingUrl: string, hardLimitSeconds: number) {
  const preActivity = Math.min(15 * 60, hardLimitSeconds);
  const googleMeet = new URL(meetingUrl).hostname.toLowerCase() === "meet.google.com";
  return { preActivity, waitingRoom: Math.min(preActivity, googleMeet ? 600 : 900) };
}

// Provider timestamps, not the time a sleeping tab wakes, bound the estimate.
export function captureElapsedSeconds(startedAt: number, endedAt: number | null, now = Date.now()) {
  if (!Number.isFinite(startedAt) || startedAt <= 0) return 0;
  const until = endedAt !== null && Number.isFinite(endedAt) ? Math.min(endedAt, now) : now;
  return Math.max(0, (until - startedAt) / 1000);
}
