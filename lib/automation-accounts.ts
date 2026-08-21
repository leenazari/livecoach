import "server-only";

import { supabaseService } from "@/lib/supabase";
import type { ServiceRecordScope } from "@/lib/service-scope";

export async function listActiveAccountScopes(options?: {
  googleConnectedOnly?: boolean;
  connectedOnly?: boolean;
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
  if ((options?.googleConnectedOnly || options?.connectedOnly) && rows.length) {
    const ownerIds = rows.map((row: any) => row.user_id);
    const [{ data: googleRows, error: googleError }, microsoftResult] =
      await Promise.all([
        supabaseService
          .from("google_oauth")
          .select("owner_id")
          .in("owner_id", ownerIds)
          .not("refresh_token", "is", null),
        options.connectedOnly
          ? supabaseService
              .from("microsoft_oauth")
              .select("owner_id")
              .in("owner_id", ownerIds)
              .not("refresh_token", "is", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
    if (googleError) throw googleError;
    if (microsoftResult.error) throw microsoftResult.error;
    const connected = new Set(
      [...(googleRows || []), ...(microsoftResult.data || [])].map(
        (row: any) => row.owner_id
      )
    );
    rows = rows.filter((row: any) => connected.has(row.user_id));
  }

  return rows.map((row: any) => ({
    userId: String(row.user_id),
    workspaceId: String(row.workspace_id),
  }));
}
