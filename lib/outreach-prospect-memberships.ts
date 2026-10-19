import type { SupabaseClient } from "@supabase/supabase-js";

const MEMBERSHIP_FIELDS =
  "campaign_id,prospect_id,recipient_email,status,current_step,last_sent_at,next_action_at,updated_at";

// IDs must come from the caller's already-authorised prospect list. Use that
// same RLS-scoped client, never the service client, for campaign membership.
export async function loadProspectMemberships(
  client: SupabaseClient,
  workspaceId: string,
  prospectIds: string[],
  pristineOnly = false
): Promise<any[]> {
  const ids = [...new Set(prospectIds.filter(Boolean))];
  const rows: any[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    for (let offset = 0; ; offset += 1000) {
      let query = client.from("outreach_enrolments")
        .select(MEMBERSHIP_FIELDS)
        .eq("workspace_id", workspaceId)
        .in("prospect_id", batch)
        .order("updated_at", { ascending: false })
        .order("prospect_id", { ascending: true })
        .order("campaign_id", { ascending: true });
      if (pristineOnly) query = query.eq("status", "paused").is("last_sent_at", null);
      const { data, error } = await query.range(offset, offset + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
  }
  return rows.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}
