import "server-only";

import { internalAppOrigin, publicAppOrigin } from "@/lib/public-app-url";
import type { RecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";

export async function requestCalendarSync(scope: RecordScope, mode = "full") {
  const { data, error } = await supabaseService.rpc("request_calendar_sync", {
    p_workspace_id: scope.workspaceId, p_owner_id: scope.userId, p_mode: mode,
  });
  if (error) throw error;
  if (!data) throw new Error("Active calendar account required");
}

export async function claimCalendarSync(scope: RecordScope) {
  const { data, error } = await supabaseService.rpc("claim_calendar_sync", {
    p_workspace_id: scope.workspaceId, p_owner_id: scope.userId,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function finishCalendarSync(scope: RecordScope, job: any, failure: string | null) {
  const { data, error } = await supabaseService.rpc("finish_calendar_sync", {
    p_workspace_id: scope.workspaceId, p_owner_id: scope.userId,
    p_lease_token: job.lease_token, p_version: job.requested_version, p_error: failure,
  });
  if (error) throw error;
  if (!data) throw new Error("Calendar sync lease no longer owned");
}

// A fresh authenticated server request gives the existing calendar and bot
// routes their normal verified service context. Never forward browser cookies.
export async function kickCalendarSync(scope: RecordScope) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Calendar worker is not configured");
  // Production deployment URLs can require Vercel SSO even though the
  // canonical app domain is public. Use that domain with the normal service
  // credential. Previews must still stay on their own deployment.
  const origin = process.env.VERCEL_ENV === "production" ? publicAppOrigin() : internalAppOrigin();
  const response = await fetch(`${origin}/api/crm/calendar-sync?pending=1`, {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(290000),
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: scope.userId, workspaceId: scope.workspaceId }),
  });
  if (!response.ok) throw new Error(`Calendar worker failed (${response.status})`);
}

export async function startConnectedCalendarSync(scope: RecordScope) {
  await requestCalendarSync(scope);
  await kickCalendarSync(scope);
}
