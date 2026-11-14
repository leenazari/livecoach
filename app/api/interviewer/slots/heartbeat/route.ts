import { effectiveCallMinutes } from "@/lib/interviewer/call-limit";
import { interviewerRpc, isUuid } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession } from "@/lib/interviewer/queue-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const token = String(body.token || "");
    const sessionId = String(body.sessionId || "");
    if (!isUuid(sessionId)) return interviewerJson({ error: "This link is not available." }, 404);
    const linked = await linkedSession(token, sessionId);
    if (!linked?.campaign) return interviewerJson({ error: "This link is not available." }, 404);
    const limitMs = effectiveCallMinutes(linked.campaign.max_minutes) * 60 * 1000;
    if (linked.session.connected_at && Date.now() >= Date.parse(String(linked.session.connected_at)) + limitMs) {
      await interviewerRpc("end_interviewer_session", { p_token: token, p_session_id: sessionId });
      return interviewerJson({ state: "time_limit" });
    }
    const state = await interviewerRpc<{ ok?: boolean; state?: string }>("heartbeat_interviewer_slot", {
      p_token: token,
      p_session_id: sessionId,
    });
    if (!state?.ok) return interviewerJson({ state: "lost" });
    return interviewerJson({ state: "held" });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
