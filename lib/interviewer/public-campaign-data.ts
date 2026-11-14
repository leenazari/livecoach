import "server-only";

import { supabaseService } from "@/lib/supabase";
import {
  isCampaignToken,
  publicCallMinutes,
  publicCallsOpen,
  publicSummary,
  type PublicCampaignView,
} from "@/lib/interviewer/public-campaign";

export type PublicCampaignCard = PublicCampaignView & {
  workspaceId: string;
  ownerId: string;
};

export async function loadPublicCampaignCard(campaignId: string): Promise<PublicCampaignCard | null> {
  if (!isCampaignToken(campaignId)) return null;
  const campaign = await supabaseService
    .from("interviewer_campaigns")
    .select("id, name, owner_id, workspace_id, max_minutes")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaign.error || !campaign.data?.id || !campaign.data.owner_id) return null;
  const documents = await supabaseService
    .from("interviewer_documents")
    .select("title, body")
    .eq("campaign_id", campaignId)
    .limit(40);
  const slides = await supabaseService
    .from("interviewer_slides")
    .select("one_line, title, slide_number")
    .eq("campaign_id", campaignId)
    .order("slide_number", { ascending: true })
    .limit(8);
  const notes = documents.error ? [] : documents.data || [];
  const first = (slides.data || []).find((slide) => Number(slide.slide_number) === 1) || slides.data?.[0];
  const slideLine = String(first?.one_line || first?.title || "");
  return {
    id: String(campaign.data.id),
    name: String(campaign.data.name || "This campaign"),
    summary: publicSummary(String(campaign.data.name || ""), notes, slideLine),
    accepting: publicCallsOpen(notes),
    maxMinutes: publicCallMinutes(campaign.data.max_minutes),
    workspaceId: String(campaign.data.workspace_id),
    ownerId: String(campaign.data.owner_id),
  };
}
