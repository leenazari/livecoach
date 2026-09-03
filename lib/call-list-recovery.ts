export function shouldShowUnrecordedScheduledCall(input: {
  scheduledAt?: string | null;
  completedAt?: string | null;
  nowMs: number;
  graceMs: number;
  startedWithoutCapture: boolean;
}): boolean {
  if (input.completedAt) return true;
  const scheduledMs = input.scheduledAt
    ? new Date(input.scheduledAt).getTime()
    : 0;
  if (!Number.isFinite(scheduledMs) || scheduledMs <= 0) return false;
  if (scheduledMs < input.nowMs - input.graceMs) return true;
  // Opening the live session is stronger evidence than the calendar time alone.
  // If capture then produced no usable transcript, surface it immediately as an
  // unrecorded call so the user can attach a manual recap instead of losing it.
  return input.startedWithoutCapture && scheduledMs <= input.nowMs;
}
