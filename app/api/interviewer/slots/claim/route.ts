import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { claimForToken, presentQueue } from "@/lib/interviewer/queue-view";

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
    return interviewerJson(queue);
  } catch (error) {
    return interviewerPublicError(error);
  }
}
