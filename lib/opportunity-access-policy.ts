export type OpportunityAccessScope = {
  userId: string;
  workspaceId: string;
  role: "owner" | "manager" | "sales";
};

export type OpportunityAccessRow = {
  id?: string;
  workspace_id: string | null;
  owner_id: string | null;
  visibility: string | null;
  opportunity_type: string | null;
  assigned_to_user_id: string | null;
  company_id: string | null;
};

/**
 * Canonical read rule for a CRM opportunity.
 *
 * The workspace owner is the only role with a complete workspace view. Every
 * other user can read their own records plus a non-confidential revenue deal
 * that was explicitly made team-visible and assigned to them. Internal,
 * strategic and investment records never cross an owner boundary.
 */
export function canReadOpportunity(
  scope: OpportunityAccessScope,
  row: OpportunityAccessRow,
  nonConfidentialCompanyIds: ReadonlySet<string> = new Set()
): boolean {
  if (!row.workspace_id || row.workspace_id !== scope.workspaceId) return false;
  if (scope.role === "owner") return true;
  if (row.owner_id === scope.userId) return true;
  if ((row.opportunity_type || "revenue") !== "revenue") return false;
  if (row.visibility !== "team") return false;
  if (row.assigned_to_user_id !== scope.userId) return false;
  if (!row.company_id) return false;
  return nonConfidentialCompanyIds.has(row.company_id);
}

export function filterVisibleOpportunities<T extends OpportunityAccessRow>(
  scope: OpportunityAccessScope,
  rows: readonly T[],
  nonConfidentialCompanyIds: ReadonlySet<string> = new Set()
): T[] {
  return rows.filter((row) =>
    canReadOpportunity(scope, row, nonConfidentialCompanyIds)
  );
}
