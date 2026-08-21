import "server-only";

import { resolveRecordScope } from "@/lib/record-scope";
import { getRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export type AppConfigRow = {
  key: string;
  value: string | null;
  note: string | null;
  updated_at: string;
  visibility: "private" | "team";
  owner_id: string;
  workspace_id: string;
};

const TEAM_CONFIG_KEYS = new Set([
  "revenue_target_gbp",
  "interviewa_outreach_offer_truth",
  "outreach_default_booking_url",
  "outreach_daily_limit",
]);

export async function getAppConfigRows(
  keys: string[]
): Promise<AppConfigRow[]> {
  if (!keys.length) return [];
  const scope = await resolveRecordScope();
  const { data, error } = await supabaseService
    .from("app_config")
    .select("key,value,note,updated_at,visibility,owner_id,workspace_id")
    .eq("workspace_id", scope.workspaceId)
    .in("key", keys)
    .or(`owner_id.eq.${scope.userId},visibility.eq.team`);
  if (error) throw error;
  return (data || []) as AppConfigRow[];
}

export async function getAppConfigValue(
  key: string
): Promise<AppConfigRow | null> {
  const scope = await resolveRecordScope();
  const rows = await getAppConfigRows([key]);
  return (
    rows.find(
      (row) => row.visibility === "private" && row.owner_id === scope.userId
    ) ||
    rows.find((row) => row.visibility === "team") ||
    rows[0] ||
    null
  );
}

export async function setAppConfigValue(input: {
  key: string;
  value: string;
  note?: string;
  visibility?: "private" | "team";
}): Promise<AppConfigRow> {
  const scope = await resolveRecordScope();
  const visibility =
    input.visibility || (TEAM_CONFIG_KEYS.has(input.key) ? "team" : "private");
  if (visibility === "team") {
    if (!TEAM_CONFIG_KEYS.has(input.key)) {
      throw new Error("This configuration cannot be shared with the workspace");
    }
    const requestScope = getRequestScope();
    if (
      requestScope &&
      requestScope.role !== "owner" &&
      requestScope.role !== "manager"
    ) {
      throw new Error("Only a workspace owner or manager can change shared settings");
    }
  }
  let query = supabaseService
    .from("app_config")
    .select("key,value,note,updated_at,visibility,owner_id,workspace_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("key", input.key);
  query =
    visibility === "team"
      ? query.eq("visibility", "team")
      : query.eq("owner_id", scope.userId).eq("visibility", "private");
  const { data: existing, error: readError } = await query.limit(1).maybeSingle();
  if (readError) throw readError;

  const now = new Date().toISOString();
  if (existing) {
    const { data, error } = await supabaseService
      .from("app_config")
      .update({
        value: input.value,
        note: input.note ?? existing.note,
        updated_at: now,
      })
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", existing.owner_id)
      .eq("key", input.key)
      .select("key,value,note,updated_at,visibility,owner_id,workspace_id")
      .single();
    if (error) throw error;
    return data as AppConfigRow;
  }

  const { data, error } = await supabaseService
    .from("app_config")
    .insert({
      key: input.key,
      value: input.value,
      note: input.note || null,
      updated_at: now,
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      visibility,
    })
    .select("key,value,note,updated_at,visibility,owner_id,workspace_id")
    .single();
  if (error) throw error;
  return data as AppConfigRow;
}
