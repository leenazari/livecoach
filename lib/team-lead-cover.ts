import "server-only";
import { supabaseService } from "@/lib/supabase";
import { sharedClientBlockReason } from "@/lib/client-sharing-policy";

type Scope = { userId: string; workspaceId: string };

async function enabled(userId: string, workspaceId: string) {
  const { data: member, error } = await supabaseService.from("workspace_members")
    .select("user_id").eq("workspace_id", workspaceId).eq("user_id", userId)
    .eq("status", "active").maybeSingle();
  if (error) throw error;
  if (!member) return false;
  const { data: workspace, error: workspaceError } = await supabaseService.from("workspaces")
    .select("team_lead_cover_enabled").eq("id", workspaceId).maybeSingle();
  if (workspaceError) throw workspaceError;
  return workspace?.team_lead_cover_enabled === true;
}

export const teamLeadCoverEnabled = (scope: Scope) => enabled(scope.userId, scope.workspaceId);

// Core sales fields only. Mailboxes, transcripts, documents, private profile
// intelligence and non-sales relationships are outside holiday cover.
export async function loadTeamLeadCoverCompanies(scope: Scope, companyIds?: string[]): Promise<any[]> {
  if (!(await teamLeadCoverEnabled(scope)) || companyIds?.length === 0) return [];
  let query = supabaseService.from("companies")
    .select("id,name,domain,website,sector,stage,notes,profile,is_confidential,created_at,updated_at,workspace_id,owner_id")
    .eq("workspace_id", scope.workspaceId).eq("is_confidential", false)
    .order("updated_at", { ascending: false }).limit(1000);
  if (companyIds) query = query.in("id", companyIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).filter((company) => company.profile?.internal !== true && !sharedClientBlockReason(company)).map((company) => ({
    ...company, profile: {}, attributes: {}, email_context: null, commercial_memory: null,
  }));
}

export async function loadTeamLeadCoverCompany(companyId: string, scope: Scope) {
  return (await loadTeamLeadCoverCompanies(scope, [companyId]))[0] || null;
}

export async function loadTeamLeadNotes(companyId: string, scope: Scope) {
  if (!(await loadTeamLeadCoverCompany(companyId, scope))) return [];
  const { data, error } = await supabaseService.from("client_context")
    .select("id,kind,title,content,created_at,owner_id,company_id,workspace_id,metadata,source_ref,url")
    .eq("workspace_id", scope.workspaceId).eq("company_id", companyId)
    .eq("kind", "note").is("source_ref", null)
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}
