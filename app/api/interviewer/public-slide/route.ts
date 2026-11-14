import { isCampaignToken } from "@/lib/interviewer/public-campaign";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mimeFor(path: string, stored: string | null): string {
  if (stored && stored.startsWith("image/")) return stored;
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

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
    .select("image_path, image_mime")
    .eq("deck_id", deck.data.id)
    .eq("slide_number", 1)
    .maybeSingle();
  if (slide.error || !slide.data?.image_path) return new Response(null, { status: 404 });
  const file = await supabaseService.storage.from("interviewer-slides").download(String(slide.data.image_path));
  if (file.error || !file.data) return new Response(null, { status: 404 });
  const bytes = await file.data.arrayBuffer();
  return new Response(bytes, {
    headers: {
      "Content-Type": mimeFor(String(slide.data.image_path), slide.data.image_mime ? String(slide.data.image_mime) : null),
      "Cache-Control": "private, max-age=300",
    },
  });
}
