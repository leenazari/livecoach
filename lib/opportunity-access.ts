import "server-only";

import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import type { RequestScope } from "@/lib/request-scope";
import {
  canReadOpportunity,
  filterVisibleOpportunities,
  type OpportunityAccessRow,
} from "@/lib/opportunity-access-policy";

type LoadOptions = {
  select?: string;
  status?: string;
  opportunityType?: string;
  companyId?: string;
  limit?: number;
  orderBy?: string;
  ascending?: boolean;
};

const unique = (values: (string | null | undefined)[]) =>
  [...new Set(values.filter((value): value is string => Boolean(value)))];

async function nonConfidentialCompanyIds(
  workspaceId: string,
  companyIds: string[]
): Promise<Set<string>> {
  const ids = unique(companyIds);
  if (!ids.length) return new Set();
  const { data, error } = await supabaseService
    .from("companies")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_confidential", false)
    .in("id", ids);
  if (error) throw error;
  return new Set((data || []).map((company: any) => String(company.id)));
}

function buildOpportunityQuery(scope: RequestScope, options: LoadOptions) {
  let query: any = supabaseAdmin
    .from("opportunities")
    .select(options.select || "*")
    .eq("workspace_id", scope.workspaceId);
  if (options.status) query = query.eq("status", options.status);
  if (options.opportunityType)
    query = query.eq("opportunity_type", options.opportunityType);
  if (options.companyId) query = query.eq("company_id", options.companyId);
  if (options.orderBy) {
    query = query.order(options.orderBy, {
      ascending: options.ascending === true,
    });
  }
  return query.limit(Math.max(1, Math.min(1000, options.limit || 500)));
}

function sortRows(rows: any[], options: LoadOptions) {
  const key = options.orderBy;
  if (!key) return rows;
  const direction = options.ascending === true ? 1 : -1;
  return rows.sort((left, right) => {
    const a = left?.[key];
    const b = right?.[key];
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return String(a).localeCompare(String(b)) * direction;
  });
}

/**
 * Load only the opportunities that the signed-in workspace member may read.
 * Service-role database access is intentionally narrowed before any row is
 * returned to a route.
 */
export async function loadVisibleOpportunities<T = Record<string, any>>(
  scope: RequestScope,
  options: LoadOptions = {}
): Promise<T[]> {
  const limit = Math.max(1, Math.min(1000, options.limit || 500));
  if (scope.role === "owner") {
    const { data, error } = await buildOpportunityQuery(scope, {
      ...options,
      limit,
    });
    if (error) throw error;
    return (data || []) as T[];
  }

  const ownedQuery = buildOpportunityQuery(scope, { ...options, limit }).eq(
    "owner_id",
    scope.userId
  );
  const assignedQuery = buildOpportunityQuery(scope, { ...options, limit })
    .eq("opportunity_type", "revenue")
    .eq("visibility", "team")
    .eq("assigned_to_user_id", scope.userId)
    .not("company_id", "is", null);
  const [ownedResult, assignedResult] = await Promise.all([
    ownedQuery,
    assignedQuery,
  ]);
  if (ownedResult.error) throw ownedResult.error;
  if (assignedResult.error) throw assignedResult.error;

  const candidates = [
    ...(ownedResult.data || []),
    ...(assignedResult.data || []),
  ] as (OpportunityAccessRow & Record<string, any>)[];
  const safeCompanyIds = await nonConfidentialCompanyIds(
    scope.workspaceId,
    candidates
      .filter((row) => row.owner_id !== scope.userId)
      .map((row) => row.company_id || "")
  );
  const visible = filterVisibleOpportunities(scope, candidates, safeCompanyIds);
  const byId = new Map(visible.map((row) => [String(row.id), row]));
  return sortRows([...byId.values()], options).slice(0, limit) as T[];
}

export async function loadVisibleOpportunityById<T = Record<string, any>>(
  scope: RequestScope,
  opportunityId: string,
  select = "*"
): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .select(select)
    .eq("workspace_id", scope.workspaceId)
    .eq("id", opportunityId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as OpportunityAccessRow & Record<string, any>;
  if (scope.role === "owner" || row.owner_id === scope.userId) return row as T;
  const safeCompanyIds = await nonConfidentialCompanyIds(
    scope.workspaceId,
    row.company_id ? [row.company_id] : []
  );
  return canReadOpportunity(scope, row, safeCompanyIds)
    ? (row as T)
    : null;
}
