export type CrmBlockerOwner = "user" | "manager" | "owner" | "system";

export type CrmBlocker = {
  code: string;
  title: string;
  reason: string;
  nextAction: string;
  responsible: CrmBlockerOwner;
};

export type CrmBlockerInput = {
  code: string;
  title: string;
  reason: string;
  nextAction: string;
  responsible?: CrmBlockerOwner;
};

const cleanSentence = (value: unknown) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

export function crmBlockerPayload(input: CrmBlockerInput): {
  error: string;
  blocker: CrmBlocker;
} {
  const blocker: CrmBlocker = {
    code: String(input.code || "crm_action_blocked").trim(),
    title: cleanSentence(input.title),
    reason: cleanSentence(input.reason),
    nextAction: cleanSentence(input.nextAction),
    responsible: input.responsible || "user",
  };
  return {
    error: [blocker.title, blocker.reason, blocker.nextAction]
      .filter(Boolean)
      .join(" "),
    blocker,
  };
}

export function crmBlockerMessage(input: CrmBlockerInput): string {
  return crmBlockerPayload(input).error;
}
