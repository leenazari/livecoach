import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

// A cheap source pointer, not a second copy of the note or a generated plan.
// Company-wide notes must not contaminate a different department/workstream.
export async function latestNotificationActionContext(scope: { userId: string; workspaceId: string }, companyId: string, workstreamId?: string | null) {
  let query = supabaseAdmin.from("client_context").select("id")
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("company_id", companyId)
    .eq("metadata->>source", "notification_action").eq("metadata->request->>mode", "log")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  query = workstreamId ? query.eq("workstream_id", workstreamId) : query.is("workstream_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.id || null;
}
