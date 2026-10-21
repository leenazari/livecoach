import { randomUUID } from "node:crypto";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export function crmReadError(area: string, stage: string, error: unknown) {
  const reference = randomUUID();
  const code = String((error as { code?: unknown } | null)?.code || "");
  // Do not log database messages, query strings, emails, tokens or record data.
  console.error("crm_read_failed", {
    reference, area, stage,
    code: /^[A-Z0-9_]{1,32}$/.test(code) ? code : "request_failed",
  });
  return crmBlockerPayload({
    code: "crm_read_failed",
    title: `${area} could not load`,
    reason: "The server could not retrieve the complete list. No records have been changed",
    nextAction: `Retry this list. If it still fails, share this reference with a workspace owner — ${reference}`,
    responsible: "system",
  });
}
