import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crmBlockerPayload } from "@/lib/crm-blocker";

// The execution route still needs the complete, flexible research/campaign
// payloads. These fields are present in both the minimal and full projections.
type PreparationProspect = Record<string, any> & {
  id: string;
  assigned_to_user_id: string | null;
  website?: string | null;
  company_domain?: string | null;
};
type PreparationEnrolment = Record<string, any> & { id: string; campaign_id: string; status: string; queued_for: string };
type PreparationCampaign = Record<string, any> & { id: string; status: string };

// Brain proposals and the execution route use this same read-only preflight.
// Always use the caller's RLS-scoped client. An assigned prospect may have a
// shared campaign membership created by a teammate, so membership owner_id
// is deliberately not used as an authorization substitute.
export async function loadOutreachPreparation(input: {
  client: SupabaseClient;
  scope: { userId: string; workspaceId: string };
  prospectId: string;
  today: string;
  fullRecords?: boolean;
}) {
  const { client, scope, prospectId, today, fullRecords } = input;
  const blocked = (status: number, code: string, title: string, reason: string,
    nextAction: string, responsible: "user" | "manager" = "user") => ({
    ok: false as const, status,
    ...crmBlockerPayload({ code, title, reason, nextAction, responsible }),
  });
  const { data: prospect, error: prospectError } = await client
    .from("outreach_prospects")
    .select(fullRecords ? "*" : "id,assigned_to_user_id")
    .eq("workspace_id", scope.workspaceId).eq("id", prospectId)
    .returns<PreparationProspect[]>().maybeSingle();
  if (prospectError) throw prospectError;
  if (!prospect) return blocked(404, "outreach_prepare_prospect_unavailable",
    "Prospect unavailable", "This prospect is not available in your CRM account",
    "Refresh Outreach and choose an available prospect");
  if (prospect.assigned_to_user_id !== scope.userId) return blocked(403,
    "outreach_prepare_assignment_required", "Prospect assignment required",
    "Assign this prospect to yourself before preparing outreach",
    "Ask a manager to confirm the assignment, then request research again", "manager");

  const { data: enrolments, error: enrolmentError } = await client
    .from("outreach_enrolments")
    .select(fullRecords ? "*" : "id,campaign_id,status,queued_for")
    .eq("workspace_id", scope.workspaceId).eq("prospect_id", prospectId)
    .eq("queued_for", today).in("status", ["queued", "researched", "drafted"])
    .limit(2).returns<PreparationEnrolment[]>();
  if (enrolmentError) throw enrolmentError;
  if (!enrolments?.length) return blocked(400, "outreach_prepare_queue_required",
    "Add this prospect to today's queue", "This person is not in today's queue",
    "Add this prospect to today's Outreach queue, then request research again");
  if (enrolments.length > 1) return blocked(409, "outreach_prepare_duplicate_queue",
    "Duplicate queue entries need review",
    "This person has more than one active item in today's queue",
    "Ask a manager to resolve the duplicate queue entries before research runs", "manager");
  const enrolment = enrolments[0];
  const { data: campaign, error: campaignError } = await client
    .from("outreach_campaigns").select(fullRecords ? "*" : "id,status")
    .eq("workspace_id", scope.workspaceId).eq("id", enrolment.campaign_id)
    .returns<PreparationCampaign[]>().maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign || campaign.status !== "active") return blocked(400,
    "outreach_prepare_campaign_inactive", "Campaign needs to be active",
    "The campaign is not active",
    "Ask the campaign owner to review and activate the campaign before requesting research", "manager");
  return { ok: true as const, prospect, enrolment, campaign };
}
