export type BrainSalesViewerScope = {
  userId: string;
  role: "owner" | "manager" | "sales";
} | null;

export type BrainOutreachAssignment = {
  assigned_to_user_id?: string | null;
};

export type BrainClientShare = {
  company_id: string;
  status?: string | null;
  assigned_to_user_id?: string | null;
};

export type BrainOutreachPartition<T> = {
  actionable: T[];
  claimable: T[];
  assignedToOthers: T[];
};

// Team rows can remain visible in intentionally shared CRM screens. Only the
// workspace owner receives the full Brain view. Every other role is limited to
// their own assignments, even when they explicitly ask for somebody else's.
export function partitionBrainOutreach<T extends BrainOutreachAssignment>(
  rows: T[],
  scope: BrainSalesViewerScope
): BrainOutreachPartition<T> {
  if (!scope || scope.role === "owner") {
    return {
      actionable: rows,
      claimable: [],
      assignedToOthers: [],
    };
  }

  return {
    actionable: rows.filter(
      (row) => row.assigned_to_user_id === scope.userId
    ),
    claimable: rows.filter((row) => !row.assigned_to_user_id),
    assignedToOthers: rows.filter(
      (row) =>
        !!row.assigned_to_user_id &&
        row.assigned_to_user_id !== scope.userId
    ),
  };
}

export function personalOutreachSenderId(
  scope: BrainSalesViewerScope
): string | null {
  return scope && scope.role !== "owner" ? scope.userId : null;
}

export function isLimitedBrainScope(
  scope: BrainSalesViewerScope
): boolean {
  return !!scope && scope.role !== "owner";
}

export function brainSharedClientIds(
  shares: BrainClientShare[],
  scope: BrainSalesViewerScope
): string[] {
  if (!scope) return [];
  const ids = shares
    .filter(
      (share) =>
        share.status === "active" &&
        (scope.role === "owner" ||
          share.assigned_to_user_id === scope.userId)
    )
    .map((share) => share.company_id)
    .filter(Boolean);
  return [...new Set(ids)];
}
