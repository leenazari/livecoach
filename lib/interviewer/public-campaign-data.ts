import "server-only";

import { supabaseService } from "@/lib/supabase";
import {
  isCampaignToken,
  publicCallMinutes,
  publicCallsOpen,
  publicSummary,
  type PublicCampaignView,
} from "@/lib/interviewer/public-campaign";
import { LANDING_ACCENT, LANDING_ON, accentFromPng } from "@/lib/interviewer/slide-colour";

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
  const deck = await supabaseService
    .from("interviewer_decks")
    .select("id")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const slide = deck.data?.id
    ? await supabaseService
      .from("interviewer_slides")
      .select("one_line, title, slide_number, image_path")
      .eq("deck_id", deck.data.id)
      .eq("slide_number", 1)
      .maybeSingle()
    : { data: null, error: null };
  const notes = documents.error ? [] : documents.data || [];
  const slideLine = String(slide.data?.one_line || slide.data?.title || "");
  const imagePath = slide.data?.image_path ? String(slide.data.image_path) : "";
  let heroUrl: string | null = null;
  let accent = LANDING_ACCENT;
  let accentOn = LANDING_ON;
  if (imagePath) {
    const signed = await supabaseService.storage.from("interviewer-slides").createSignedUrl(imagePath, 60 * 30);
    heroUrl = signed.data?.signedUrl || null;
    const file = await supabaseService.storage.from("interviewer-slides").download(imagePath);
    if (file.data) {
      const colours = accentFromPng(Buffer.from(await file.data.arrayBuffer()));
      accent = colours.accent;
      accentOn = colours.on;
    }
  }
  return {
    id: String(campaign.data.id),
    name: String(campaign.data.name || "This campaign"),
    summary: publicSummary(String(campaign.data.name || ""), notes, slideLine),
    accepting: publicCallsOpen(notes),
    maxMinutes: publicCallMinutes(campaign.data.max_minutes),
    heroUrl,
    heroAlt: slideLine || "Opening slide",
    accent,
    accentOn,
    workspaceId: String(campaign.data.workspace_id),
    ownerId: String(campaign.data.owner_id),
  };
}
