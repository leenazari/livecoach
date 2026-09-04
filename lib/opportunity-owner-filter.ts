export type OpportunityOwnerRow = {
  owner_id?: string | null;
  assigned_to_user_id?: string | null;
};

export function opportunityMatchesOwner(
  row: OpportunityOwnerRow,
  ownerFilter: string,
  currentUserId: string
): boolean {
  if (ownerFilter === "all") return true;
  if (ownerFilter === "mine")
    return (
      row.owner_id === currentUserId ||
      row.assigned_to_user_id === currentUserId
    );
  if (ownerFilter === "unassigned") return !row.assigned_to_user_id;
  return row.assigned_to_user_id === ownerFilter;
}
