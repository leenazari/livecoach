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

export type CrmFallbackBlockerInput = {
  status?: number;
  url?: string;
  method?: string;
  serverMessage?: unknown;
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

const INTERNAL_ERROR_DETAIL =
  /(?:postgres|supabase|sqlstate|syntax error|duplicate key|violates|constraint|column .* does not exist|relation .* does not exist|permission denied|row[- ]level security|for (?:table|relation|schema) [a-z0-9_."]+|42501|stack trace|econn|enotfound|jwt|service role|fetch failed)/i;

const VAGUE_ERROR =
  /^(?:error|failed|failure|forbidden|unauthori[sz]ed|not found|request failed|unexpected response|company not found|client not found|contact not found|task not found|call not found|opportunity not found|prospect not found|nothing to update|could not save|failed to save|failed to update|failed to delete)(?:[.! ]*)$/i;

function safeLegacyReason(value: unknown): string {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text || VAGUE_ERROR.test(text) || INTERNAL_ERROR_DETAIL.test(text)) {
    return "";
  }
  return text;
}

function crmResource(url: string): { key: string; label: string; lower: string } {
  const path = String(url || "").toLowerCase();
  if (path.includes("/email-pull"))
    return { key: "email", label: "Email history", lower: "email history" };
  if (path.includes("/companies"))
    return { key: "company", label: "Company", lower: "company" };
  if (path.includes("/contacts"))
    return { key: "contact", label: "Contact", lower: "contact" };
  if (path.includes("/opportunities") || path.includes("/revenue"))
    return { key: "opportunity", label: "Opportunity", lower: "opportunity" };
  if (path.includes("/tasks"))
    return { key: "task", label: "To-do", lower: "to-do" };
  if (path.includes("/upcoming") || path.includes("/calls"))
    return { key: "call", label: "Call", lower: "call" };
  if (path.includes("/outreach") || path.includes("/sendpilot"))
    return { key: "outreach", label: "Outreach", lower: "outreach" };
  if (path.includes("/documents"))
    return { key: "document", label: "Document", lower: "document" };
  if (path.includes("/chat"))
    return { key: "chat", label: "Chat", lower: "chat" };
  if (path.includes("/notifications"))
    return { key: "notification", label: "Notification", lower: "notification" };
  if (path.includes("/assistant") || path.includes("/brain"))
    return { key: "brain", label: "Brain", lower: "Brain" };
  if (path.includes("/calendar"))
    return { key: "calendar", label: "Calendar", lower: "calendar" };
  return { key: "record", label: "CRM", lower: "CRM" };
}

// One final safety net for every CRM request. Routes should return their own
// precise blocker where possible, but a legacy or unexpected response must
// still tell the user what happened, why, what to do next and who owns the fix.
export function crmFallbackBlockerPayload(
  input: CrmFallbackBlockerInput
): { error: string; blocker: CrmBlocker } {
  const status = Number(input.status || 0);
  const method = String(input.method || "GET").toUpperCase();
  const resource = crmResource(String(input.url || ""));
  const legacyReason = safeLegacyReason(input.serverMessage);
  const write = method !== "GET";
  let title = write
    ? `${resource.label} action blocked`
    : `${resource.label} could not be loaded`;
  let reason =
    legacyReason ||
    `LiveCoach could not complete this ${resource.lower} request`;
  let nextAction =
    "Refresh the page and try once more. If it repeats, send the blocker code to a workspace owner";
  let responsible: CrmBlockerOwner = "system";

  if (!status) {
    title = "Connection interrupted";
    reason = "LiveCoach could not reach the CRM server";
    nextAction =
      "Check your internet connection, refresh the page, then try the action once more";
    responsible = "user";
  } else if (status === 400 || status === 422) {
    title = `${resource.label} needs more information`;
    reason =
      legacyReason ||
      `Some information for this ${resource.lower} is missing or invalid`;
    nextAction =
      "Review the details shown, correct the missing or invalid information, then try again";
    responsible = "user";
  } else if (status === 401) {
    title = "Sign-in required";
    reason = "LiveCoach could not verify your current CRM session";
    nextAction = "Refresh the page and sign in again before retrying the action";
    responsible = "user";
  } else if (status === 403) {
    title = "Access blocked";
    reason =
      legacyReason ||
      `Your account does not have permission to use this ${resource.lower}`;
    nextAction =
      "Ask a workspace owner or manager to confirm your access and assignment before trying again";
    responsible = "owner";
  } else if (status === 404) {
    title = `${resource.label} unavailable`;
    reason =
      legacyReason ||
      `This ${resource.lower} no longer exists or is not available to your account`;
    nextAction =
      "Refresh the page. If it is still missing, ask a workspace owner to confirm it exists and is shared with you";
    responsible = "owner";
  } else if (status === 409 || status === 412) {
    title = `${resource.label} action blocked`;
    reason =
      legacyReason ||
      `This ${resource.lower} conflicts with its current status, owner, or another active action`;
    nextAction =
      "Refresh the record and resolve the existing status or ownership conflict before trying again";
    responsible = "manager";
  } else if (status === 413) {
    title = "File too large";
    reason = legacyReason || "The selected upload exceeds the CRM file limit";
    nextAction = "Choose a smaller file, then upload it again";
    responsible = "user";
  } else if (status === 429) {
    title = "CRM temporarily limited";
    reason = legacyReason || "LiveCoach received too many requests in a short period";
    nextAction =
      "Wait one minute and try once. If the limit continues, ask a workspace owner to review usage";
    responsible = "system";
  } else if (status >= 500) {
    title = `${resource.label} action not confirmed`;
    reason =
      legacyReason ||
      `LiveCoach could not safely confirm this ${resource.lower} action`;
    nextAction =
      "Refresh the record and try once more. If it repeats, send the blocker code to a workspace owner";
    responsible = "system";
  }

  return crmBlockerPayload({
    code: `crm_${resource.key}_${status || "network"}`,
    title,
    reason,
    nextAction,
    responsible,
  });
}
