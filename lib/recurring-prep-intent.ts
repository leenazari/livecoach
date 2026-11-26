export type RecurringPrepEvidence = {
  lastCall?: { headline: string; at: string } | null;
  gap?: string;
  promises?: { text: string; dueAt?: string | null }[];
  email?: { context: string } | null;
};

const sentence = (text: string) => text.replace(/[.!?]+$/, "").trim();

export function recurringPrepIntent(evidence: RecurringPrepEvidence) {
  if (!evidence.lastCall?.headline) return "";
  const previous = sentence(evidence.lastCall.headline);
  const focus = evidence.gap
    ? `I want to follow up on the last meeting (${previous}) and clarify this open point: ${sentence(evidence.gap)}.`
    : `I want to check what changed since the last meeting: ${previous}.`;
  const actions = evidence.promises?.map(row => {
    const when = row.dueAt && Number.isFinite(Date.parse(row.dueAt))
      ? ` (due ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(row.dueAt))})` : "";
    return sentence(row.text) + when;
  }).filter(Boolean).slice(0, 2);
  return [
    focus,
    actions?.length ? `Check progress on ${actions.join("; ")} and agree who owns the next step.` : "",
    evidence.email?.context ? `Confirm the latest email update: ${sentence(evidence.email.context)}.` : "",
  ].filter(Boolean).join(" ");
}
