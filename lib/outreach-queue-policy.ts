export type ResumableOutreachEnrolment = {
  status?: unknown;
  current_step?: unknown;
  queued_for?: unknown;
  last_sent_at?: unknown;
};

const RESUMABLE_FIRST_TOUCH_STATUSES = new Set([
  "paused",
  "queued",
  "researched",
  "drafted",
  "approved",
]);

// An unsent first touch may return to the working queue when it has never been
// queued or belongs to an earlier day. A row already reserved for today or a
// future day must stay put so repeated page loads cannot duplicate it.
export function canResumeUnsentFirstTouch(
  enrolment: ResumableOutreachEnrolment | null | undefined,
  today: string
): boolean {
  if (!enrolment) return false;
  const status = String(enrolment.status || "");
  const queuedFor = String(enrolment.queued_for || "").trim();
  return (
    RESUMABLE_FIRST_TOUCH_STATUSES.has(status) &&
    Number(enrolment.current_step || 1) === 1 &&
    !enrolment.last_sent_at &&
    (!queuedFor || queuedFor < today)
  );
}
