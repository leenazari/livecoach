import { interviewerRpc, isUuid, loadOpenInvite } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { presentQueue, type InterviewerQueueState } from "@/lib/interviewer/queue-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deepgram refused the connection. Return the lead to the front of the queue
// and do not include an error the page would show.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const token = String(body.token || "");
    const sessionId = String(body.sessionId || "");
    const invite = await loadOpenInvite(token);
    if (!invite || !isUuid(sessionId)) return interviewerJson({ error: "This link is not available." }, 404);
    const state = await interviewerRpc<InterviewerQueueState>("requeue_interviewer_priority", {
      p_token: token,
      p_session_id: sessionId,
    });
    const queue = await presentQueue(state, invite.campaign_id);
    return interviewerJson({ ...queue, priority: true, state: state.state === "in_call" ? "in_call" : "queued" });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
