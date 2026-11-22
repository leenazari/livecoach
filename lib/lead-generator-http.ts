import "server-only";

import { NextResponse } from "next/server";

import { crmBlockerPayload } from "@/lib/crm-blocker";
import { LeadGeneratorError } from "@/lib/lead-generator-contract";
import { canManageLeadGenerator } from "@/lib/lead-generator-rules";
import { requireRequestScope } from "@/lib/request-scope";

export const leadGeneratorNoStore = {
  "Cache-Control": "private, no-store",
};

export function requireLeadGeneratorManager() {
  let scope: ReturnType<typeof requireRequestScope>;
  try {
    scope = requireRequestScope();
  } catch {
    throw new LeadGeneratorError({
      status: 401,
      code: "lead_generator_sign_in",
      title: "Sign-in required",
      reason: "LiveCoach could not verify your current CRM session.",
      nextAction: "Sign in again, then open Lead generator.",
      outcome: "Nothing was changed.",
      responsible: "user",
    });
  }
  if (!canManageLeadGenerator(scope.role, scope.status)) {
    throw new LeadGeneratorError({
      status: 403,
      code: "lead_generator_forbidden",
      title: "Lead generator is restricted",
      reason: "Only an active workspace owner or manager can use the lead generator.",
      nextAction: "Ask a workspace owner to confirm your role, then open the page again.",
      outcome: "Nothing was changed.",
      responsible: "owner",
    });
  }
  return scope;
}

export function leadGeneratorInvalid(message: string) {
  return new LeadGeneratorError({
    status: 400,
    code: "lead_generator_invalid",
    title: "Lead generator needs a correction",
    reason: message,
    nextAction: "Correct the highlighted details and try again. This attempt was not sent.",
    outcome: "Nothing was saved.",
    responsible: "user",
  });
}

export function leadGeneratorJson(error: unknown) {
  const failure = error instanceof LeadGeneratorError
    ? error
    : new LeadGeneratorError({
        status: 500,
        code: "lead_generator_failed",
        title: "Lead generator could not finish",
        reason: "Something went wrong before LiveCoach could confirm the result.",
        nextAction: "Refresh the page and check the campaign list before trying again.",
        outcome: "Nothing on screen confirms whether a change was saved.",
        responsible: "system",
      });
  if (!(error instanceof LeadGeneratorError)) {
    console.error("lead_generator_failed", {
      name: error instanceof Error ? error.name : "error",
    });
  }
  return NextResponse.json(
    crmBlockerPayload({
      code: failure.code,
      title: failure.title,
      reason: failure.reason,
      nextAction: failure.nextAction,
      responsible: failure.responsible,
      outcome: failure.outcome,
    }),
    { status: failure.status, headers: leadGeneratorNoStore }
  );
}
