import { NextRequest, NextResponse } from "next/server";
import { kickCalendarSync, requestCalendarSync } from "@/lib/calendar-sync-jobs";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { connectedCalendarProvider } from "@/lib/calendar-provider";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  // Database-only health check. Bootstrap new accounts and renew expiring
  // channels without polling event lists. Normal scheduling starts on push.
  const accounts = await listActiveAccountScopes({ connectedOnly: true });
  for (const scope of accounts) {
    const connection = await connectedCalendarProvider(scope.userId);
    if (!connection.provider || !connection.email) continue;
    const { data: channels, error: healthError } = await supabaseService.from("calendar_notification_channels")
      .select("id,status,needs_renewal,expires_at").eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId)
      .eq("provider", connection.provider).eq("connection_email", connection.email.trim().toLowerCase())
      .in("status", ["active", "pending"]);
    if (healthError) return NextResponse.json({ error: "Calendar watch health unavailable" }, { status: 503 });
    if (!channels?.length || channels.some((c: any) => c.status !== "active" || c.needs_renewal
      || Date.parse(c.expires_at) <= Date.now() + 36 * 3600000)) await requestCalendarSync(scope);
  }
  // Retry only pending work after a failed or interrupted worker. Accounts
  // with healthy channels and no changes make no requests to their calendar.
  const now = new Date().toISOString();
  const { data, error } = await supabaseService.from("calendar_sync_jobs")
    .select("workspace_id,owner_id,requested_version,completed_version")
    .eq("pending", true).lte("next_attempt_at", now).or(`leased_until.is.null,leased_until.lt.${now}`)
    .order("next_attempt_at").limit(500);
  if (error) return NextResponse.json({ error: "Calendar recovery unavailable" }, { status: 503 });
  const pending = (data || []).filter((j: any) => j.requested_version > j.completed_version);
  const results = await Promise.all(pending.slice(0, 20).map(async (job: any) => {
    try {
      await kickCalendarSync({ workspaceId: job.workspace_id, userId: job.owner_id });
      return true;
    } catch { return false; }
  }));
  return NextResponse.json({ ok: results.every(Boolean), retried: results.length });
}
