import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OutreachQueueRepair = {
  prospectId: string;
  enrolmentId: string;
  campaignId: string;
  campaignName: string;
  date: string;
};

// An allowlisted repair, not a general permission to change campaigns or
// restart outreach. Only an existing, unsent first touch can be requeued.
export async function loadOutreachQueueRepair(input: {
  client: SupabaseClient;
  scope: { userId: string; workspaceId: string };
  prospectId: string;
  today: string;
}): Promise<OutreachQueueRepair | null> {
  const { client, scope, prospectId, today } = input;
  const { data: prospect, error: prospectError } = await client
    .from("outreach_prospects").select("id,assigned_to_user_id,status")
    .eq("workspace_id", scope.workspaceId).eq("id", prospectId).maybeSingle();
  if (prospectError) throw prospectError;
  if (!prospect || prospect.assigned_to_user_id !== scope.userId ||
    ["suppressed", "not_interested", "replied", "qualified"].includes(prospect.status)) return null;
  const { data: memberships, error: membershipError } = await client
    .from("outreach_enrolments")
    .select("id,campaign_id,status,current_step,queued_for,last_sent_at,next_action_at")
    .eq("workspace_id", scope.workspaceId).eq("prospect_id", prospectId).limit(2);
  if (membershipError) throw membershipError;
  if (memberships?.length !== 1) return null;
  const row = memberships[0];
  if (!["queued", "researched", "drafted"].includes(row.status) ||
    Number(row.current_step) !== 1 || row.last_sent_at || row.next_action_at ||
    (row.queued_for && row.queued_for >= today)) return null;
  const { data: campaign, error: campaignError } = await client
    .from("outreach_campaigns").select("id,name,status,sequence")
    .eq("workspace_id", scope.workspaceId).eq("id", row.campaign_id).maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign || campaign.status !== "active") return null;
  const firstStep = Array.isArray(campaign.sequence)
    ? campaign.sequence.find((step: any) => Number(step?.step) === 1) : null;
  if (firstStep && (firstStep.channel || "email") !== "email") return null;
  return { prospectId, enrolmentId: row.id, campaignId: campaign.id,
    campaignName: String(campaign.name || "Existing campaign").slice(0, 180), date: today };
}

export function sameOutreachQueueRepair(expected: unknown, actual: OutreachQueueRepair): boolean {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false;
  const value = expected as Record<string, unknown>;
  return ["prospectId", "enrolmentId", "campaignId", "date"].every(
    key => value[key] === actual[key as keyof OutreachQueueRepair]
  );
}
