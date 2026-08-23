export type BrainSalesViewerScope = {
  userId: string;
  role: "owner" | "manager" | "sales";
} | null;

export type BrainOutreachAssignment = {
  assigned_to_user_id?: string | null;
};

export type BrainOutreachPartition<T> = {
  actionable: T[];
  claimable: T[];
  assignedToOthers: T[];
};

// Team outreach rows remain visible in the shared CRM, but a salesperson's
// Brain must never turn another teammate's assignment into personal advice.
export function partitionBrainOutreach<T extends BrainOutreachAssignment>(
  rows: T[],
  scope: BrainSalesViewerScope
): BrainOutreachPartition<T> {
  if (!scope || scope.role !== "sales") {
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
  return scope?.role === "sales" ? scope.userId : null;
}

export function isSalesBrainScope(
  scope: BrainSalesViewerScope
): boolean {
  return scope?.role === "sales";
}
