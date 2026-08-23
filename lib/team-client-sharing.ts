import "server-only";

import { supabaseAdmin, supabaseService } from "@/lib/supabase";
export { sharedClientBlockReason } from "@/lib/client-sharing-policy";

export const SAFE_SHARED_COMPANY_SELECT =
  "id,name,domain,website,sector,stage,created_at,updated_at,workspace_id,owner_id";

export type SharedClientGrant = {
  id: string;
  company_id: string;
  status: "active" | "revoked";
  shared_by_user_id: string;
  assigned_to_user_id: string | null;
  assigned_by_user_id: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SafeSharedCompany = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  sector: string | null;
  stage: string | null;
  profile: Record<string, never>;
  attributes: Record<string, never>;
  notes: null;
  email_context: null;
  commercial_memory: null;
  created_at: string;
  updated_at: string;
};

const uniqueIds = (ids: string[]) => [...new Set(ids.filter(Boolean))];

export function safeSharedCompany(row: any): SafeSharedCompany {
  return {
    id: String(row.id),
    name: String(row.name || "Unnamed client"),
    domain: row.domain || null,
    website: row.website || null,
    sector: row.sector || null,
    stage: row.stage || null,
    profile: {},
    attributes: {},
    notes: null,
    email_context: null,
    commercial_memory: null,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

export async function listVisibleClientGrants(
  workspaceId: string
): Promise<SharedClientGrant[]> {
  const { data, error } = await supabaseAdmin
    .from("team_client_shares")
    .select(
      "id,company_id,status,shared_by_user_id,assigned_to_user_id,assigned_by_user_id,assigned_at,created_at,updated_at"
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []) as SharedClientGrant[];
}

export async function activeSharedClientIds(
  workspaceId: string
): Promise<string[]> {
  const grants = await listVisibleClientGrants(workspaceId);
  return grants
    .filter((grant) => grant.status === "active")
    .map((grant) => grant.company_id);
}

export async function loadSafeSharedCompanies(
  companyIds: string[],
  workspaceId: string
): Promise<SafeSharedCompany[]> {
  const ids = uniqueIds(companyIds);
  if (!ids.length) return [];
  const { data, error } = await supabaseService
    .from("companies")
    .select(SAFE_SHARED_COMPANY_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("is_confidential", false)
    .in("id", ids);
  if (error) throw error;
  return (data || []).map(safeSharedCompany);
}

export async function loadSafeSharedCompany(
  companyId: string,
  workspaceId: string
): Promise<SafeSharedCompany | null> {
  const rows = await loadSafeSharedCompanies([companyId], workspaceId);
  return rows[0] || null;
}
