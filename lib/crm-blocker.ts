export type CrmBlockerOwner = "user" | "manager" | "owner" | "system";

export type CrmBlocker = {
  code: string;
  title: string;
  reason: string;
  nextAction: string;
  responsible: CrmBlockerOwner;
  // Only claim a saved/unchanged outcome when the route can prove it. An
  // interrupted response is not proof that the underlying write failed.
  outcome?: string;
  reference?: string;
};

export type CrmBlockerInput = {
  code: string;
  title: string;
  reason: string;
  nextAction: string;
  responsible?: CrmBlockerOwner;
  outcome?: string;
  reference?: string;
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
    ...(typeof input.outcome === "string" && input.outcome.trim()
      ? { outcome: cleanSentence(input.outcome) }
      : {}),
    ...(typeof input.reference === "string" && /^[a-f0-9-]{36}$/i.test(input.reference)
      ? { reference: input.reference }
      : {}),
  };
  return {
    error: [blocker.title, blocker.reason, blocker.outcome, blocker.nextAction]
      .filter(Boolean)
      .join(" "),
    blocker,
  };
}

export function crmBlockerMessage(input: CrmBlockerInput): string {
  return crmBlockerPayload(input).error;
}

const INTERNAL_ERROR_DETAIL =
  /(?:postgres|supabase|sqlstate|syntax error|duplicate key|violates|constraint|column .* does not exist|relation .* does not exist|permission denied|row[- ]level security|for (?:table|relation|schema) [a-z0-9_."]+|\b(?:42501|23502|PGRST\d+)\b|stack trace|econn|enotfound|jwt|service.?role|access_token|refresh_token|authorization|bearer\s|fetch failed|TypeError|ReferenceError|<!doctype|<html|<body|<script)/i;

const VAGUE_ERROR =
  /^(?:(?:HTTP\s+)?\d{3}[\s:-]*)?(?:error|failed|failure|forbidden|unauthori[sz]ed|not found|bad request|internal server error|bad gateway|service unavailable|gateway timeout|request timeout|request failed|unexpected response|company not found|client not found|contact not found|task not found|call not found|opportunity not found|prospect not found|draft not found|nothing to update|could not save|failed to save(?: draft)?|failed to update|failed to delete)(?:[.! ]*)$/i;

function safeLegacyReason(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text || VAGUE_ERROR.test(text) || INTERNAL_ERROR_DETAIL.test(text)) {
    return "";
  }
  return text.slice(0, 500);
}

function crmResource(url: string): { key: string; label: string; lower: string } {
  const path = String(url || "").split(/[?#]/)[0].toLowerCase();
  // Keep existing support codes stable, but name the operation people were
  // actually using instead of calling every failure an "Outreach action".
  if (/\/outreach\/messages\/[^/]+\/send$/.test(path))
    return { key: "outreach", label: "Email sending", lower: "email sending" };
  if (/\/outreach\/messages\/[^/]+\/voice$/.test(path))
    return { key: "outreach", label: "Voice note generation", lower: "voice note generation" };
  if (/\/outreach\/messages\/[^/]+\/rehearse$/.test(path))
    return { key: "outreach", label: "Test email", lower: "test email" };
  if (path.includes("/outreach/messages/"))
    return { key: "outreach", label: "Email draft", lower: "email draft" };
  if (path.includes("/outreach/queue"))
    return { key: "outreach", label: "Outreach queue", lower: "outreach queue" };
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
  const write = !["GET", "HEAD"].includes(method);
  let title = write
    ? `${resource.label} action blocked`
    : `${resource.label} could not be loaded`;
  let reason =
    legacyReason ||
    `LiveCoach could not complete this ${resource.lower} request`;
  let nextAction =
    "Keep any unsaved text and reopen the record to check its latest state. If the problem continues, share the support code with a workspace owner";
  let responsible: CrmBlockerOwner = "system";
  let outcome: string | undefined;
  const checkBeforeRetry = /\/(?:send|queue|rehearse)$/.test(String(input.url || "").split(/[?#]/)[0])
    ? "Check Activity and the send queue before trying again. Do not send another copy if this email is already queued or sent. If its status is unclear, share the support code with a workspace owner"
    : /\/voice$/.test(String(input.url || "").split(/[?#]/)[0])
      ? "Check the draft for a finished or still-generating voice note before trying again. Generating another note may incur another charge. If its status is unclear, share the support code with a workspace owner"
      : "Copy any unsaved text, then reopen the record to check its latest state before trying again. If it is still unclear, share the support code with a workspace owner";

  if (!status) {
    title = "Connection interrupted";
    reason = "LiveCoach did not receive a complete reply from the server";
    outcome = write
      ? "Your changes may already have been saved. Their status could not be checked"
      : "The information on screen may be out of date. A loading error does not mean your records are missing";
    nextAction = write
      ? `Check your internet connection. ${checkBeforeRetry}`
      : "Check your internet connection, then try loading this page again";
    responsible = "user";
  } else if (status === 400 || status === 422) {
    title = `${resource.label} needs more information`;
    reason =
      legacyReason ||
      `Some information for this ${resource.lower} is missing or invalid`;
    nextAction =
      "Check the required fields and any highlighted details, then try again. If no field is highlighted, share the support code with a workspace owner so they can find the rejected step";
    responsible = "user";
  } else if (status === 401) {
    title = "Sign-in required";
    reason = "LiveCoach could not verify your current CRM session";
    nextAction = "Copy any unsaved text, then sign in again and reopen the record";
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
      `Another update or a CRM safety rule stopped this ${resource.lower} request. The server did not identify the exact conflict`;
    nextAction =
      "Reopen the record and check the reason above. If you cannot resolve it, share the support code with a workspace owner. Do not repeat a send while its status is unclear";
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
      "Wait before trying again. If a daily limit is shown, wait until it resets. If this continues, ask a workspace owner to check the limit";
    responsible = "system";
  } else if (status >= 500 || status === 408) {
    title = write
      ? `${resource.label} could not be confirmed`
      : `${resource.label} could not be loaded`;
    reason =
      legacyReason ||
      (status === 408 || status === 504
        ? "The server took too long to reply"
        : "A server problem prevented LiveCoach from confirming the result");
    outcome = write
      ? "Some or all of your changes may already be saved. LiveCoach could not verify the final result"
      : "The information on screen may be out of date. A loading error does not mean your records are missing";
    nextAction = write ? checkBeforeRetry
      : "Try loading this list again. If it still fails, share the support code with a workspace owner";
    responsible = "system";
  }

  return crmBlockerPayload({
    code: `crm_${resource.key}_${status || "network"}`,
    title,
    reason,
    nextAction,
    responsible,
    outcome,
  });
}
