import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { loadSafeSharedCompany } from "@/lib/team-client-sharing";

import { loadTeamLeadCoverCompany } from "@/lib/team-lead-cover";

export type AssignedClientAccess = {
  mode: "owner" | "shared_sales";
  company: any;
  shareId: string | null;
};

// Return a client only when the signed-in account owns it or is the exact
// salesperson named on an active safe-share grant, or has owner-enabled
// team lead cover for this ordinary sales company.
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

  const coverCompany = await loadTeamLeadCoverCompany(companyId, scope);
  if (coverCompany) return { mode: "shared_sales", company: coverCompany, shareId: null };

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
