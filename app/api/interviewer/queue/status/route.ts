import { interviewerJson, interviewerPublicError, readJson, readyEmailStillDisabled } from "@/lib/interviewer/http";
import { presentQueue, queueStatusForToken } from "@/lib/interviewer/queue-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // TODO: Email the lead when a slot is offered. interviewerReadyEmailStatus
    // stays disabled until the owner explicitly approves a message.
    readyEmailStillDisabled();
    const body = await readJson(req);
    const token = String(body.token || "");
    const sessionId = String(body.sessionId || "");
    const { invite, state } = await queueStatusForToken(token, sessionId);
    if (!invite || !state || state.ok === false) {
      return interviewerJson({ error: "This link is not available." }, 404);
    }
    return interviewerJson(await presentQueue(state, invite.campaign_id));
  } catch (error) {
    return interviewerPublicError(error);
  }
}
