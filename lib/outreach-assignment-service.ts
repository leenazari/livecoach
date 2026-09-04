import "server-only";

import { supabaseService } from "@/lib/supabase";

export type OutreachAssignmentResult = {
  assignedIds: string[];
  assignedCount: number;
  companyAccessShared: number;
  linkedCompaniesHeldPrivate: number;
  assignedToUserId: string;
  updatedAt: string;
};

function uniqueIds(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

export async function assignOutreachProspectsWithCompanyAccess(input: {
  actorUserId: string;
  workspaceId: string;
  prospectIds: string[];
  assignedToUserId: string;
}): Promise<OutreachAssignmentResult> {
  const prospectIds = uniqueIds(input.prospectIds);
  if (!prospectIds.length) {
    return {
      assignedIds: [],
      assignedCount: 0,
      companyAccessShared: 0,
      linkedCompaniesHeldPrivate: 0,
      assignedToUserId: input.assignedToUserId,
      updatedAt: new Date().toISOString(),
    };
  }

  const { data, error } = await supabaseService.rpc(
    "assign_outreach_prospects_with_company_access_service",
    {
      p_actor_user_id: input.actorUserId,
      p_workspace_id: input.workspaceId,
      p_prospect_ids: prospectIds,
      p_assigned_to_user_id: input.assignedToUserId,
    }
  );
  if (error) throw error;

  const saved = data && typeof data === "object" ? (data as any) : null;
  const assignedIds = Array.isArray(saved?.assignedIds)
    ? uniqueIds(saved.assignedIds)
    : [];
  if (
    !saved ||
    saved.assignedToUserId !== input.assignedToUserId ||
    assignedIds.length !== prospectIds.length ||
    prospectIds.some((id) => !assignedIds.includes(id))
  ) {
    throw new Error("The database did not confirm the complete outreach assignment");
  }

  return {
    assignedIds,
    assignedCount: Number(saved.assignedCount || assignedIds.length),
    companyAccessShared: Number(saved.companyAccessShared || 0),
    linkedCompaniesHeldPrivate: Number(
      saved.linkedCompaniesHeldPrivate || 0
    ),
    assignedToUserId: String(saved.assignedToUserId),
    updatedAt: String(saved.updatedAt || ""),
  };
}

export function outreachAssignmentConflict(error: unknown): string | null {
  const message = String((error as any)?.message || error || "").toLowerCase();
  if (message.includes("another teammate claimed")) {
    return "Another teammate claimed this prospect first";
  }
  if (message.includes("already assigned to another salesperson")) {
    return "The linked company is already assigned to another salesperson";
  }
  if (message.includes("private to another user")) {
    return "This prospect is private to another user";
  }
  return null;
}
