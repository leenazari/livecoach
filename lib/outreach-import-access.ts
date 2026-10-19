import "server-only";

import { requireRequestScope, type RequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export async function canStageOutreachImports(
  scope: Pick<RequestScope, "workspaceId" | "userId" | "status">
): Promise<boolean> {
  if (scope.status !== "active") return false;
  const { data, error } = await supabaseService.rpc("can_stage_outreach_import_service", {
    p_workspace_id: scope.workspaceId,
    p_actor_user_id: scope.userId,
  });
  if (error) throw error;
  return data === true;
}

export async function requireOutreachImportAccess(): Promise<RequestScope> {
  const scope = requireRequestScope();
  if (!(await canStageOutreachImports(scope))) {
    throw new Error("Active workspace membership is required to import your own leads");
  }
  return scope;
}
