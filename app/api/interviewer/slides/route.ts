import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const linked = await linkedSession(String(body.token || ""), String(body.sessionId || ""));
    if (!linked) return interviewerJson({ error: "This link is not available." }, 404);
    const number = Number(body.slideNumber ?? body.slide_number);
    if (!Number.isInteger(number) || number < 1) {
      return interviewerJson({ shown: false, note: "That slide number is not on the deck." });
    }
    const { data: slide, error } = await supabaseService
      .from("interviewer_slides")
      .select("slide_number, title, one_line, image_path")
      .eq("campaign_id", linked.session.campaign_id)
      .eq("slide_number", number)
      .order("slide_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !slide) return interviewerJson({ shown: false, note: "That slide is not on this campaign." });
    const signed = await supabaseService.storage.from("interviewer-slides").createSignedUrl(slide.image_path, 60 * 10);
    await supabaseService.from("interviewer_slide_shows").insert({
      workspace_id: linked.session.workspace_id,
      session_id: linked.session.id,
      slide_number: number,
      reason: String(body.reason || "").slice(0, 240) || null,
    });
    return interviewerJson({
      shown: true,
      slideNumber: number,
      title: slide.title,
      url: signed.data?.signedUrl || null,
    });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
