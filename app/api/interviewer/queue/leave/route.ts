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
    const invite = await loadOpenInvite(token);
    if (!invite || !isUuid(sessionId)) return interviewerJson({ error: "This link is not available." }, 404);
    const state = await interviewerRpc<InterviewerQueueState>("leave_interviewer_queue", {
      p_token: token,
      p_session_id: sessionId,
    });
    return interviewerJson(await presentQueue(state, invite.campaign_id));
  } catch (error) {
    return interviewerPublicError(error);
  }
}
