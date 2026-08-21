import "server-only";

import {
  privateRecordFields,
  resolveRecordScope,
  workspaceProfileId,
} from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";

export async function ensureWorkspaceProfileId(): Promise<string> {
  const scope = await resolveRecordScope();
  const { data: existing, error: readError } = await supabaseAdmin
    .from("workspace_profile")
    .select("id")
    .eq("owner_id", scope.userId)
    .limit(1)
    .maybeSingle();
  if (readError) throw readError;
  if (existing?.id) return String(existing.id);

  const id = workspaceProfileId(scope.userId);
  const { data, error } = await supabaseAdmin
    .from("workspace_profile")
    .insert({
      id,
      knowledge: "",
      ...privateRecordFields(scope),
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}
