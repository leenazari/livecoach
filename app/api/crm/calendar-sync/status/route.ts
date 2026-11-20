import { NextResponse } from "next/server";
import { getRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

// This only reports the signed-in person's sync. It never reads a caller-
// supplied owner ID, provider credential, calendar entry or another user's job.
export async function GET() {
  const scope = getRequestScope();
  if (!scope || scope.status !== "active") {
    return NextResponse.json(crmBlockerPayload({
      code: "calendar_sync_status_access_required",
      title: "Calendar sync check blocked",
      reason: "An active signed-in workspace account is required to check calendar sync",
      nextAction: "Sign in again with your own active LiveCoach account. If your account is inactive, ask your workspace owner to restore access",
      responsible: "user",
    }), { status: 403, headers });
  }
  try {
    const { data, error } = await supabaseService
      .from("calendar_sync_jobs")
      .select("requested_version,completed_version,completed_at,last_error,leased_until")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ state: "unknown" }, { headers });
    const running = data.leased_until && new Date(data.leased_until).getTime() > Date.now();
    if (data.last_error && !running) {
      return NextResponse.json({ state: "failed", message: "Your calendar update needs attention. Open Calls to review the latest saved meetings, then try Sync calendar again. No meetings have been deleted by this check." }, { headers });
    }
    const complete = Number(data.completed_version) >= Number(data.requested_version) && Boolean(data.completed_at);
    return NextResponse.json({
      state: complete ? "complete" : "pending",
      finishedAt: complete ? data.completed_at : null,
    }, { headers });
  } catch {
    return NextResponse.json(crmBlockerPayload({
      code: "calendar_sync_status_unavailable",
      title: "Calendar sync could not be checked",
      reason: "LiveCoach could not confirm whether your calendar update has finished",
      nextAction: "Open Calls to check the latest saved meetings. Do not recreate the event in your calendar",
      responsible: "system",
    }), { status: 503, headers });
  }
}
