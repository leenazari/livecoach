import "server-only";

import { supabaseService } from "@/lib/supabase";
import type { ServiceRecordScope } from "@/lib/service-scope";

export async function listActiveAccountScopes(options?: {
  googleConnectedOnly?: boolean;
  ownersOnly?: boolean;
}): Promise<ServiceRecordScope[]> {
  let query = supabaseService
    .from("workspace_members")
    .select("user_id,workspace_id,role")
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (options?.ownersOnly) query = query.eq("role", "owner");
  const { data: members, error } = await query;
  if (error) throw error;

  let rows = members || [];
  if (options?.googleConnectedOnly && rows.length) {
    const { data: googleRows, error: googleError } = await supabaseService
      .from("google_oauth")
      .select("owner_id")
      .in("owner_id", rows.map((row: any) => row.user_id))
      .not("refresh_token", "is", null);
    if (googleError) throw googleError;
    const connected = new Set((googleRows || []).map((row: any) => row.owner_id));
    rows = rows.filter((row: any) => connected.has(row.user_id));
  }

  return rows.map((row: any) => ({
    userId: String(row.user_id),
    workspaceId: String(row.workspace_id),
  }));
}
