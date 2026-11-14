import { buildVoiceAgentSettings, DEEPGRAM_VOICE_AGENT_URL } from "@/lib/interviewer/agent-settings";
import { knowledgeManifest } from "@/lib/interviewer/prompt";
import { interviewerRpc, loadCampaignDocuments } from "@/lib/interviewer/data";
import { mintDeepgramGrant } from "@/lib/interviewer/deepgram-grant";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession, presentQueue, queueStatusForToken, type InterviewerQueueState } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";
import { customerHeadline, formatDeckKnowledge, headlineFromNotes } from "@/lib/interviewer/slide-headline";
import { interviewerVoiceOrFallback } from "@/lib/interviewer/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function queued(token: string, sessionId: string, campaignId: string) {
  const status = await queueStatusForToken(token, sessionId);
  if (!status.state || status.state.ok === false) {
    return interviewerJson({ state: "queued", sessionId, waitLabel: "Waiting for a seat", overTenMinutes: false });
  }
  return interviewerJson(await presentQueue(status.state, campaignId));
}

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const token = String(body.token || "");
    const sessionId = String(body.sessionId || "");
    const purpose = body.purpose === "listen" ? "listen" : "both";
    const linked = await linkedSession(token, sessionId);
    if (!linked?.campaign) return interviewerJson({ error: "This link is not available." }, 404);
    if (!linked.slot) return queued(token, sessionId, linked.invite.campaign_id);

    const agentGrant = await mintDeepgramGrant();
    if (!agentGrant.ok && agentGrant.reason === "concurrency") {
      const state = await interviewerRpc<InterviewerQueueState>("requeue_interviewer_priority", {
        p_token: token,
        p_session_id: sessionId,
      });
      const queue = await presentQueue(state, linked.invite.campaign_id);
      return interviewerJson({ ...queue, state: "queued", priority: true });
    }
    if (!agentGrant.ok) {
      return interviewerJson(
        { error: "The voice connection is not available right now." },
        agentGrant.reason === "unconfigured" ? 503 : 502
      );
    }

    let listenToken = agentGrant.accessToken;
    if (purpose === "both") {
      const listenGrant = await mintDeepgramGrant();
      if (!listenGrant.ok && listenGrant.reason === "concurrency") {
        const state = await interviewerRpc<InterviewerQueueState>("requeue_interviewer_priority", {
          p_token: token,
          p_session_id: sessionId,
        });
        const queue = await presentQueue(state, linked.invite.campaign_id);
        return interviewerJson({ ...queue, state: "queued", priority: true });
      }
      if (listenGrant.ok) listenToken = listenGrant.accessToken;
    }

    if (purpose !== "listen" && !linked.session.connected_at) {
      await supabaseService
        .from("interviewer_sessions")
        .update({
          connected_at: new Date().toISOString(),
          status: "connected",
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .is("connected_at", null);
    }

    const voiceId = interviewerVoiceOrFallback(linked.campaign.voice_id);
    const documents = purpose === "listen" ? [] : await loadCampaignDocuments(linked.campaign.id);
    const extras = await supabaseService
      .from("interviewer_campaigns")
      .select("website_url, opener, quotes_allowed, brochure_send")
      .eq("id", linked.campaign.id)
      .maybeSingle();
    const extra = extras.error ? null : extras.data;
    const deck = purpose === "listen"
      ? { data: [] as Array<{ id: string; outline?: string | null }> }
      : await supabaseService
          .from("interviewer_decks")
          .select("id, outline")
          .eq("campaign_id", linked.campaign.id)
          .order("created_at", { ascending: false })
          .limit(1);
    const deckId = deck.data?.[0]?.id ? String(deck.data[0].id) : null;
    const storedOutline = deck.data?.[0]?.outline ? String(deck.data[0].outline) : "";
    const slideResult = !deckId
      ? { data: [] as Array<{ slide_number: number; title: string; one_line: string; talking_points: string | null; verbatim: string | null; image_path: string | null }> }
      : await supabaseService
          .from("interviewer_slides")
          .select("slide_number, title, one_line, talking_points, verbatim, image_path")
          .eq("deck_id", deckId)
          .order("slide_number", { ascending: true });
    const deckKnowledge = storedOutline || formatDeckKnowledge((slideResult.data || []).map((slide) => ({
      number: Number(slide.slide_number),
      title: customerHeadline(String(slide.title || "")) || String(slide.one_line || ""),
      facts: String(slide.talking_points || "").split("\n").filter(Boolean),
      prices: slide.verbatim ? String(slide.verbatim) : "",
    })));
    const slides = (slideResult.data || []).map((slide) => ({
      number: Number(slide.slide_number),
      title: customerHeadline(String(slide.title || "")) || headlineFromNotes({
        talkingPoints: slide.talking_points ? String(slide.talking_points) : "",
        oneLine: String(slide.one_line || ""),
        verbatim: slide.verbatim ? String(slide.verbatim) : null,
      }),
      oneLine: String(slide.one_line || ""),
      talkingPoints: slide.talking_points ? String(slide.talking_points) : "",
      verbatim: slide.verbatim ? String(slide.verbatim) : null,
    }));
    const slideRows = purpose === "listen" ? [] : (slideResult.data || []);
    const slideIndex = await Promise.all(slideRows.map(async (slide) => {
      let url: string | null = null;
      if (slide.image_path) {
        const signed = await supabaseService.storage.from("interviewer-slides").createSignedUrl(String(slide.image_path), 600);
        url = signed.data?.signedUrl || null;
      }
      return {
        number: Number(slide.slide_number),
        title: customerHeadline(String(slide.title || "")) || headlineFromNotes({
          talkingPoints: slide.talking_points ? String(slide.talking_points) : "",
          oneLine: String(slide.one_line || ""),
          verbatim: slide.verbatim ? String(slide.verbatim) : null,
        }),
        slogan: String(slide.verbatim || slide.one_line || ""),
        url,
      };
    }));
    const openingSlide = slideIndex.find((slide) => slide.number === 1) || slideIndex[0] || null;
    const settings = purpose === "listen"
      ? null
      : buildVoiceAgentSettings({
          campaignName: linked.campaign.name,
          prospectName: linked.invite.prospect_name,
          personaOverride: linked.campaign.persona_override,
          promptOverride: linked.campaign.prompt_override,
          maxMinutes: linked.campaign.max_minutes,
          documents,
          slides,
          voiceId,
          websiteUrl: extra?.website_url ? String(extra.website_url) : null,
          opener: extra?.opener ? String(extra.opener) : null,
          quotesAllowed: extra?.quotes_allowed === true,
          brochureSend: extra?.brochure_send === true,
          deckKnowledge,
        });
    if (settings) {
      const manifest = knowledgeManifest(String((settings as { agent?: { think?: { prompt?: string } } }).agent?.think?.prompt || ""));
      console.info("interviewer knowledge sent", {
        campaignId: linked.campaign.id,
        deckId,
        sections: manifest.sections,
        characters: manifest.characters,
        mentionsKiosk: manifest.mentionsKiosk,
      });
    }

    return interviewerJson({
      state: "ready",
      agentToken: purpose === "listen" ? null : agentGrant.accessToken,
      listenToken,
      expiresIn: agentGrant.expiresIn,
      settings,
      voiceAgentUrl: DEEPGRAM_VOICE_AGENT_URL,
      maxMinutes: linked.campaign.max_minutes,
      deckId,
      openingSlide,
      slideIndex,
    });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
