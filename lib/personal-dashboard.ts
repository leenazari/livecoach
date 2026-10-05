import "server-only";
import { supabaseService } from "@/lib/supabase";

// Deliberately private. Never inherit this presentation preference from a
// workspace-wide setting or another owner on the same team.
export async function personalCallsFirst(scope: { userId: string; workspaceId: string }): Promise<boolean> {
  const { data, error } = await supabaseService
    .from("app_config")
    .select("value")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("visibility", "private")
    .eq("key", "dashboard_calls_first")
    .maybeSingle();
  return !error && data?.value === "true";
}
