import "server-only";
import { supabaseService } from "@/lib/supabase";
import type { RequestScope } from "@/lib/request-scope";
export function coachingOwner(
  scope: Pick<RequestScope, "role" | "userId">,
  requested: string | null,
) {
  return scope.role === "owner" ? requested || null : scope.userId;
}
export async function loadCoachingCall(callId: string, scope: RequestScope) {
  let query = supabaseService
    .from("interview_summaries")
    .select("id,session_id,owner_id,company_id,candidate,summary,created_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("id", callId);
  if (scope.role !== "owner") query = query.eq("owner_id", scope.userId);
  const { data: call, error } = await query.maybeSingle();
  if (error) throw error;
  if (!call?.session_id || !call.owner_id) return null;
  return call;
}
