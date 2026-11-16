import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { claimForToken, presentQueue } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";

async function openingSlide(campaignId: string) {
  const deck = await supabaseService
    .from("interviewer_decks")
    .select("id")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (deck.error || !deck.data?.id) return null;
  const slide = await supabaseService
    .from("interviewer_slides")
    .select("slide_number, title, one_line, image_path")
    .eq("deck_id", deck.data.id)
    .eq("slide_number", 1)
    .maybeSingle();
  if (slide.error || !slide.data) return null;
  let url = "";
  if (slide.data.image_path) {
    const signed = await supabaseService.storage.from("interviewer-slides").createSignedUrl(String(slide.data.image_path), 600);
    url = signed.data?.signedUrl || "";
  }
  return {
    number: Number(slide.data.slide_number) || 1,
    url,
    title: String(slide.data.title || ""),
    slogan: String(slide.data.one_line || ""),
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const token = String(body.token || "");
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    const { invite, state } = await claimForToken(token, sessionId);
    if (!invite || !state || state.ok === false) {
      return interviewerJson({ error: "This link is not available." }, 404);
    }
    const queue = await presentQueue(state, invite.campaign_id);
    const opening = await openingSlide(invite.campaign_id);
    return interviewerJson({ ...queue, openingSlide: opening });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
