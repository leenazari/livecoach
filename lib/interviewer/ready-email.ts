// TODO: Email the lead when a slot is ready for them.
// This needs explicit owner approval before any message is sent.
// Do not import a mailer here and do not call this from a send path.
export const INTERVIEWER_READY_EMAIL = "disabled" as const;

export function interviewerReadyEmailStatus(): typeof INTERVIEWER_READY_EMAIL {
  return INTERVIEWER_READY_EMAIL;
}
