import "server-only";

import { supabaseAdmin } from "@/lib/supabase";

export type OutreachCampaignSelection = {
  campaign: Record<string, any> | null;
  campaigns: Record<string, any>[];
  selectedCampaignId: string | null;
};

export async function resolveOutreachCampaignSelection(
  userId: string,
  workspaceId: string
): Promise<OutreachCampaignSelection> {
  const [{ data: campaigns, error: campaignError }, { data: preference, error: preferenceError }] =
    await Promise.all([
      supabaseAdmin
        .from("outreach_campaigns")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("outreach_user_campaign_preferences")
        .select("active_campaign_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
  if (campaignError) throw campaignError;
  if (preferenceError && preferenceError.code !== "42P01") throw preferenceError;

  const rows = campaigns || [];
  const active = rows.filter((row: any) => row.status === "active");
  const preferred = active.find(
    (row: any) => row.id === preference?.active_campaign_id
  );
  const campaign = preferred || active[0] || null;

  return {
    campaign,
    campaigns: rows,
    selectedCampaignId: campaign?.id || null,
  };
}
