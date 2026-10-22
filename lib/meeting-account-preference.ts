import "server-only";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { GOOGLE_MEET_ACCOUNT_KEY, normaliseMeetingAccountEmail } from "@/lib/meeting-account";

export function requireActiveMeetingAccountScope() {
  const scope = requireRequestScope();
  if (scope.status !== "active") throw new Error("Active workspace access is required");
  return scope;
}

export async function getMeetingAccountPreference(): Promise<string> {
  const scope = requireActiveMeetingAccountScope();
  const { data, error } = await supabaseService
    .from("app_config")
    .select("value")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("visibility", "private")
    .eq("key", GOOGLE_MEET_ACCOUNT_KEY)
    .maybeSingle();
  if (error) throw error;
  // No workspace-wide or owner-account fallback. An unset preference leaves
  // that person's existing Google account-selection behaviour alone.
  return normaliseMeetingAccountEmail(data?.value) || "";
}
