import { NextRequest, NextResponse } from "next/server";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { readLeadClashStatus } from "@/lib/lead-clash";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function managerScope() {
  const scope = requireRequestScope();
  if (scope.status !== "active" || (scope.role !== "owner" && scope.role !== "manager")) {
    const error = new Error("workspace owner or manager access is required");
    (error as { status?: number }).status = 403;
    throw error;
  }
  return scope;
}

export async function GET() {
  try {
    const scope = managerScope();
    const leadClash = await readLeadClashStatus(scope.workspaceId);
    return NextResponse.json({ leadClash });
  } catch (err: any) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "lead_clash_settings_unavailable",
        title: "Lead clash setting unavailable",
        reason: "Only a workspace owner or manager can read this switch.",
        nextAction: "Open the setting from an owner or manager account.",
        responsible: "owner",
      }),
      { status: err?.status || 403 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = managerScope();
    const current = await readLeadClashStatus(scope.workspaceId);
    if (!current.available) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "lead_clash_settings_unavailable",
          title: "Lead clash setting is not installed",
          reason: "The lead clash switch is not available in this database yet.",
          nextAction: "Apply the lead clash migration in a preview database before changing the switch. Existing CRM behaviour is unchanged.",
          responsible: "owner",
        }),
        { status: 503 }
      );
    }
    const body = await req.json().catch(() => ({}));
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        crmBlockerPayload({
          code: "lead_clash_setting_invalid",
          title: "Lead clash switch was not changed",
          reason: "Choose on or off for the lead clash switch.",
          nextAction: "Send enabled true or false and try again. The current switch is unchanged.",
          responsible: "user",
        }),
        { status: 400 }
      );
    }
    if (body.enabled && current.forcedOff) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "lead_clash_forced_off",
          title: "Lead clash checks stay off",
          reason: "The server environment is holding lead clash checks off.",
          nextAction: "Clear LEAD_CLASH_FORCE_OFF or LEAD_CLASH_ENABLED=off before turning the workspace switch on. Nothing was changed.",
          responsible: "owner",
        }),
        { status: 409 }
      );
    }
    const { error } = await supabaseService.from("lead_clash_settings").upsert(
      {
        workspace_id: scope.workspaceId,
        enabled: body.enabled,
        updated_at: new Date().toISOString(),
        updated_by: scope.userId,
      },
      { onConflict: "workspace_id" }
    );
    if (error) throw error;
    const leadClash = await readLeadClashStatus(scope.workspaceId);
    return NextResponse.json({ ok: true, leadClash });
  } catch (err: any) {
    console.error("Lead clash setting was not saved", err?.code || err?.message);
    return NextResponse.json(
      crmBlockerPayload({
        code: "lead_clash_setting_not_confirmed",
        title: "Lead clash switch was not confirmed",
        reason: "LiveCoach could not confirm the new switch position.",
        nextAction: "Refresh the duplicate report and check whether the switch moved before trying again.",
        responsible: "system",
      }),
      { status: err?.status || 500 }
    );
  }
}
