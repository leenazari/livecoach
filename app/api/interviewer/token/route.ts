import { buildVoiceAgentSettings, DEEPGRAM_VOICE_AGENT_URL } from "@/lib/interviewer/agent-settings";
import { interviewerRpc, loadCampaignDocuments } from "@/lib/interviewer/data";
import { mintDeepgramGrant } from "@/lib/interviewer/deepgram-grant";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession, presentQueue, queueStatusForToken, type InterviewerQueueState } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";
import { isInterviewerVoiceId } from "@/lib/interviewer/voices";

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

    const voiceId = isInterviewerVoiceId(linked.campaign.voice_id) ? linked.campaign.voice_id : "aura-2-pandora-en";
    const documents = purpose === "listen" ? [] : await loadCampaignDocuments(linked.campaign.id);
    const settings = purpose === "listen"
      ? null
      : buildVoiceAgentSettings({
          campaignName: linked.campaign.name,
          prospectName: linked.invite.prospect_name,
          personaOverride: linked.campaign.persona_override,
          promptOverride: linked.campaign.prompt_override,
          maxMinutes: linked.campaign.max_minutes,
          documents,
          voiceId,
        });

    return interviewerJson({
      state: "ready",
      agentToken: purpose === "listen" ? null : agentGrant.accessToken,
      listenToken,
      expiresIn: agentGrant.expiresIn,
      settings,
      voiceAgentUrl: DEEPGRAM_VOICE_AGENT_URL,
      maxMinutes: linked.campaign.max_minutes,
    });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
