export type OutreachAssignmentCandidate = {
  status?: string | null;
  research?: unknown;
  last_researched_at?: string | null;
  last_contacted_at?: string | null;
  last_reply_at?: string | null;
};

export type OutreachAssignmentEnrolment = {
  status?: string | null;
  current_step?: number | null;
  queued_for?: string | null;
  next_action_at?: string | null;
  research?: unknown;
  research_sources?: unknown;
  researched_at?: string | null;
  last_sent_at?: string | null;
  replied_at?: string | null;
  booked_at?: string | null;
};

export type OutreachAssignmentActivity = {
  hasMessage?: boolean;
  hasRecipientMessage?: boolean;
  // Retained for older callers. New callers should pass the enrolment rows so
  // a paused, never-started campaign membership can move with the prospect.
  hasEnrolment?: boolean;
  enrolments?: OutreachAssignmentEnrolment[];
};

export function hasSavedOutreachResearch(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

export function isPristinePausedOutreachEnrolment(
  enrolment: OutreachAssignmentEnrolment
): boolean {
  return (
    enrolment.status === "paused" &&
    Number(enrolment.current_step ?? 1) <= 1 &&
    !enrolment.queued_for &&
    !enrolment.next_action_at &&
    !enrolment.researched_at &&
    !enrolment.last_sent_at &&
    !enrolment.replied_at &&
    !enrolment.booked_at &&
    !hasSavedOutreachResearch(enrolment.research) &&
    !hasSavedOutreachResearch(enrolment.research_sources)
  );
}

export function isUntouchedOutreachAssignment(
  prospect: OutreachAssignmentCandidate,
  activity: OutreachAssignmentActivity = {}
): boolean {
  const enrolmentsAreTransferable = Array.isArray(activity.enrolments)
    ? activity.enrolments.every(isPristinePausedOutreachEnrolment)
    : !activity.hasEnrolment;

  return (
    prospect.status === "imported" &&
    !prospect.last_researched_at &&
    !prospect.last_contacted_at &&
    !prospect.last_reply_at &&
    !hasSavedOutreachResearch(prospect.research) &&
    !activity.hasMessage &&
    !activity.hasRecipientMessage &&
    enrolmentsAreTransferable
  );
}
