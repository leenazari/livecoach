import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { loadSafeSharedCompany } from "@/lib/team-client-sharing";

export type AssignedClientAccess = {
  mode: "owner" | "shared_sales";
  company: any;
  shareId: string | null;
};

// Return a client only when the signed-in account owns it or is the exact
// salesperson named on an active safe-share grant. A workspace membership by
// itself is never enough to open or write another person's client record.
export async function loadAssignedClientAccess(
  companyId: string,
  scope: { userId: string; workspaceId: string }
): Promise<AssignedClientAccess | null> {
  const { data: owned, error: ownedError } = await supabaseAdmin
    .from("companies")
    .select("id,name,domain,website,sector,stage,owner_id,workspace_id")
    .eq("id", companyId)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .maybeSingle();
  if (ownedError) throw ownedError;
  if (owned) return { mode: "owner", company: owned, shareId: null };

  const { data: share, error: shareError } = await supabaseAdmin
    .from("team_client_shares")
    .select("id,company_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("company_id", companyId)
    .eq("assigned_to_user_id", scope.userId)
    .eq("status", "active")
    .maybeSingle();
  if (shareError) throw shareError;
  if (!share) return null;

  const company = await loadSafeSharedCompany(companyId, scope.workspaceId);
  return company
    ? { mode: "shared_sales", company, shareId: share.id }
    : null;
}
