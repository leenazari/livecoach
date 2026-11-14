import { isCampaignToken } from "@/lib/interviewer/public-campaign";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const campaignId = new URL(request.url).searchParams.get("campaign") || "";
  if (!isCampaignToken(campaignId)) return new Response(null, { status: 404 });
  const deck = await supabaseService
    .from("interviewer_decks")
    .select("id")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (deck.error || !deck.data?.id) return new Response(null, { status: 404 });
  const slide = await supabaseService
    .from("interviewer_slides")
    .select("image_path")
    .eq("deck_id", deck.data.id)
    .eq("slide_number", 1)
    .maybeSingle();
  if (slide.error || !slide.data?.image_path) return new Response(null, { status: 404 });
  const signed = await supabaseService.storage.from("interviewer-slides").createSignedUrl(String(slide.data.image_path), 60 * 30);
  if (signed.error || !signed.data?.signedUrl) return new Response(null, { status: 404 });
  return Response.redirect(signed.data.signedUrl, 302);
}
