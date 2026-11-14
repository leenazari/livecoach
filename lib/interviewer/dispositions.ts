export const INTERVIEWER_DISPOSITIONS = [
  "Hot",
  "Warm",
  "Nurture",
  "Bounced",
  "Wrong number",
  "Competitor chosen",
  "Timing push",
  "Closed lost",
] as const;

export type InterviewerDisposition = (typeof INTERVIEWER_DISPOSITIONS)[number];

export const TIMING_PRECISIONS = ["day", "week", "month", "quarter", "year", "unknown"] as const;

export type TimingPrecision = (typeof TIMING_PRECISIONS)[number];

const REASON_REQUIRED = new Set<InterviewerDisposition>([
  "Bounced",
  "Wrong number",
  "Competitor chosen",
  "Timing push",
  "Closed lost",
]);

export function isInterviewerDisposition(value: unknown): value is InterviewerDisposition {
  return INTERVIEWER_DISPOSITIONS.includes(value as InterviewerDisposition);
}

export function isTimingPrecision(value: unknown): value is TimingPrecision {
  return TIMING_PRECISIONS.includes(value as TimingPrecision);
}

export function dispositionNeedsReason(value: InterviewerDisposition): boolean {
  return REASON_REQUIRED.has(value);
}
