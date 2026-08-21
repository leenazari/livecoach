import "server-only";

import { getRequestScope, isVerifiedServiceRequest } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export type RecordScope = {
  userId: string;
  workspaceId: string;
};

export async function resolveRecordScope(
  explicitOwnerId?: string
): Promise<RecordScope> {
  const requestScope = getRequestScope();
  if (requestScope) {
    if (explicitOwnerId && explicitOwnerId !== requestScope.userId) {
      throw new Error("Cross-account record access is not permitted");
    }
    return {
      userId: requestScope.userId,
      workspaceId: requestScope.workspaceId,
    };
  }

  if (!isVerifiedServiceRequest()) {
    throw new Error("A verified account or service job is required");
  }

  let query = supabaseService
    .from("workspace_members")
    .select("user_id,workspace_id")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(explicitOwnerId ? 1 : 2);
  if (explicitOwnerId) query = query.eq("user_id", explicitOwnerId);
  const { data, error } = await query;
  if (error) throw error;
  if (!data?.length) throw new Error("No active workspace account was found");
  if (!explicitOwnerId && data.length !== 1) {
    throw new Error("An account owner must be selected for this background job");
  }
  return {
    userId: String(data[0].user_id),
    workspaceId: String(data[0].workspace_id),
  };
}

export function privateRecordFields(scope: RecordScope) {
  return {
    owner_id: scope.userId,
    workspace_id: scope.workspaceId,
    visibility: "private" as const,
  };
}

export function workspaceProfileId(userId: string): string {
  return `user:${userId}`;
}
