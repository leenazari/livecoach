import { interviewerRpc, isUuid, loadOpenInvite } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { presentQueue, type InterviewerQueueState } from "@/lib/interviewer/queue-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const token = String(body.token || "");
    const sessionId = String(body.sessionId || "");
    const reason = body.reason === "retry" ? "retry" : "ended";
    const invite = await loadOpenInvite(token);
    if (!invite || !isUuid(sessionId)) return interviewerJson({ error: "This link is not available." }, 404);
    const state = await interviewerRpc<InterviewerQueueState>("release_interviewer_slot", {
      p_token: token,
      p_session_id: sessionId,
      p_reason: reason,
    });
    return interviewerJson(await presentQueue(state, invite.campaign_id));
  } catch (error) {
    return interviewerPublicError(error);
  }
}
