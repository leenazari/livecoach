import "server-only";

import { NextResponse } from "next/server";

import { crmBlockerPayload } from "@/lib/crm-blocker";
import { requireWorkspaceOwner, type RequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

const noStore = { "Cache-Control": "private, no-store" };

export async function requireInterviewerOwner(): Promise<RequestScope> {
  const scope = requireWorkspaceOwner();
  const { data, error } = await supabaseAdmin
    .from("interviewer_access")
    .select("user_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("user_id", scope.userId)
    .maybeSingle();
  if (error) {
    const missing = /does not exist|schema cache|could not find the table/i.test(error.message || "");
    throw Object.assign(new Error(missing ? "not_ready" : "blocked"), { status: missing ? 503 : 500 });
  }
  if (!data) throw Object.assign(new Error("forbidden"), { status: 403 });
  return scope;
}

export function interviewerOwnerError(error: unknown) {
  const status = Number((error as { status?: number })?.status || 0);
  const message = error instanceof Error ? error.message : "";
  if (status === 403 || /workspace owner access is required/i.test(message)) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "interviewer_owner_only",
        title: "Interviewa is hidden",
        reason: "Only an owner with interviewer access can open this section.",
        nextAction: "Return to the CRM. This page is not part of the shared navigation.",
        responsible: "owner",
      }),
      { status: 403, headers: noStore }
    );
  }
  if (message === "not_ready" || status === 503) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "interviewer_not_ready",
        title: "Interviewa is not in this database yet",
        reason: "The interviewer tables have not been applied here.",
        nextAction: "Apply the interviewer migration to a Supabase branch and review it before any live database.",
        responsible: "owner",
        outcome: "No campaign, invite or calendar event was changed.",
      }),
      { status: 503, headers: noStore }
    );
  }
  return NextResponse.json(
    crmBlockerPayload({
      code: "interviewer_owner_failed",
      title: "Interviewa could not be opened",
      reason: "LiveCoach could not confirm interviewer access.",
      nextAction: "Reload this page. If it still fails, check the migration on a Supabase branch before trying again.",
      responsible: "owner",
      outcome: "No campaign or invite was confirmed.",
    }),
    { status: 500, headers: noStore }
  );
}
