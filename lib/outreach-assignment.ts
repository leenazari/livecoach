export type OutreachAssignmentCandidate = {
  status?: string | null;
  research?: unknown;
  last_researched_at?: string | null;
  last_contacted_at?: string | null;
  last_reply_at?: string | null;
};

export function hasSavedOutreachResearch(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

export function isUntouchedOutreachAssignment(
  prospect: OutreachAssignmentCandidate,
  activity: { hasMessage?: boolean; hasEnrolment?: boolean } = {}
): boolean {
  return (
    prospect.status === "imported" &&
    !prospect.last_researched_at &&
    !prospect.last_contacted_at &&
    !prospect.last_reply_at &&
    !hasSavedOutreachResearch(prospect.research) &&
    !activity.hasMessage &&
    !activity.hasEnrolment
  );
}
