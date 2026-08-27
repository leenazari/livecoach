export const MANUAL_OUTREACH_CALL_OUTCOMES = [
  "connected",
  "meeting_booked",
  "callback_requested",
  "voicemail",
  "no_answer",
  "not_now",
  "wrong_contact",
  "not_interested",
  "do_not_contact",
] as const;

export type ManualOutreachCallOutcome =
  (typeof MANUAL_OUTREACH_CALL_OUTCOMES)[number];

export const MANUAL_OUTREACH_CALL_LABELS: Record<
  ManualOutreachCallOutcome,
  string
> = {
  connected: "Connected",
  meeting_booked: "Meeting booked",
  callback_requested: "Call back requested",
  voicemail: "Left voicemail",
  no_answer: "No answer",
  not_now: "Not now",
  wrong_contact: "Wrong contact",
  not_interested: "Not interested",
  do_not_contact: "Do not contact",
};

export function defaultManualCallNextAction(
  outcome: ManualOutreachCallOutcome
): string {
  const actions: Record<ManualOutreachCallOutcome, string> = {
    connected: "Follow up on the agreed point from the call",
    meeting_booked: "Prepare for the booked meeting",
    callback_requested: "Call back at the agreed time",
    voicemail: "Send a short follow up and retry the call",
    no_answer: "Call again at a different time",
    not_now: "Reconnect at the agreed time",
    wrong_contact: "Find and contact the correct decision maker",
    not_interested: "No further follow up",
    do_not_contact: "Do not contact again",
  };
  return actions[outcome];
}

export function defaultManualCallDueDays(
  outcome: ManualOutreachCallOutcome
): number | null {
  if (outcome === "meeting_booked" || outcome === "callback_requested") return 1;
  if (outcome === "connected" || outcome === "voicemail" || outcome === "no_answer") return 2;
  if (outcome === "not_now") return 14;
  if (outcome === "wrong_contact") return 1;
  return null;
}

export function manualCallNextActionAt(
  outcome: ManualOutreachCallOutcome,
  requestedDate?: string | null,
  now = new Date()
): string | null {
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return `${requestedDate}T12:00:00.000Z`;
  }
  const days = defaultManualCallDueDays(outcome);
  if (days == null) return null;
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + days);
  due.setUTCHours(12, 0, 0, 0);
  return due.toISOString();
}

export function nextProspectStatus(
  current: string,
  outcome: ManualOutreachCallOutcome
): string {
  if (outcome === "do_not_contact") return "suppressed";
  if (outcome === "not_interested") return "not_interested";
  if (outcome === "meeting_booked") return "qualified";
  if (["qualified", "replied"].includes(current)) return current;
  return "contacted";
}
