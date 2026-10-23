import type { CrmBlocker } from "@/lib/crm-blocker";
import { isUuid } from "@/lib/uuid";

const SEGMENTS = new Set([
  "outreach", "assistant", "brain", "sendpilot", "execute", "thread",
  "outreach-approve", "outreach-voice", "assign-work", "share", "remember",
  "interview", "messages", "send", "voice", "voice-script", "rehearse",
  "campaigns", "select", "queue", "prepare", "assign", "enrolments", "cta",
  "follow-up", "handover", "manual-call", "next-action", "sequence-action",
  "engage", "readiness", "metrics", "replies", "draft", "resolve",
  "research-jobs", "suppressions", "control", "receipts", "executions", "undo",
]);
const METHODS = new Set(["GET", "POST", "PATCH", "DELETE", "PUT"]);
const CATEGORIES = [
  ["sendpilot_link_missing", /not linked to your SendPilot|no verified lead linked/i],
  ["queue_membership_required", /not in today's queue/i],
  ["campaign_inactive", /campaign is not active|choose an active campaign|campaign is not selected/i],
  ["queue_full", /queue already has/i],
  ["outreach_history_exists", /already has outreach history/i],
  ["contact_suppressed", /do-not-contact list/i],
  ["prospect_ineligible", /not eligible for prospect outreach/i],
  ["opt_out_required", /keep the simple opt-out line/i],
  ["draft_already_sent", /already sent cannot be changed/i],
  ["assignment_required", /assigned to another|not assigned to your/i],
  ["invalid_input", /required|invalid|choose|missing/i],
] as const;

// Browser reports are diagnostic evidence, never authorization or proof that
// a mutation happened. Do not accept messages, bodies, query values or tokens.
export function crmBlockerDiagnostic(input: {
  url?: unknown; method?: unknown; status?: unknown; code?: unknown;
  reasonCategory?: unknown;
}) {
  if (typeof input.url !== "string" || input.url.length > 1000) return null;
  const path = input.url.split(/[?#]/, 1)[0];
  const parts = path.split("/");
  if (parts[0] !== "" || parts[1] !== "api" || parts[2] !== "crm" ||
      !["outreach", "assistant", "brain", "sendpilot"].includes(parts[3]) ||
      parts.slice(3).some(part => !SEGMENTS.has(part) && !isUuid(part))) return null;
  const method = String(input.method || "").toUpperCase();
  const status = Number(input.status);
  const code = typeof input.code === "string" ? input.code : "";
  if (!METHODS.has(method) || !Number.isInteger(status) ||
      !(status === 0 || status >= 400 && status <= 599) ||
      !/^[a-z][a-z0-9_]{0,99}$/.test(code)) return null;
  const reasonCategory = CATEGORIES.some(([category]) => category === input.reasonCategory)
    ? String(input.reasonCategory) : "unclassified";
  return { path, method, status, code, reasonCategory };
}

const recent = new Map<string, number>();
export function reportCrmBlocker(blocker: CrmBlocker | null, url: string, method: string, status: number) {
  if (typeof window === "undefined" || !blocker) return;
  const reasonCategory = CATEGORIES.find(([, pattern]) => pattern.test(blocker.reason))?.[0];
  const diagnostic = crmBlockerDiagnostic({ url, method, status, code: blocker.code, reasonCategory });
  if (!diagnostic) return;
  const key = JSON.stringify(diagnostic);
  const now = Date.now();
  if (now - (recent.get(key) || 0) < 60_000) return;
  for (const [entry, at] of recent) if (now - at >= 60_000) recent.delete(entry);
  if (recent.size >= 20) return;
  recent.set(key, now);
  // Raw fetch prevents diagnostic failures from reporting themselves or
  // retrying the original action. Reporting must never hide its error UI.
  try {
    void fetch("/api/crm/blocker-reports", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(diagnostic),
    }).catch(() => {});
  } catch { /* the original blocker remains visible */ }
}
