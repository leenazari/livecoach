import { interviewerRpc, isUuid, loadOpenInvite } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const token = String(body.token || "");
    const sessionId = String(body.sessionId || "");
    const invite = await loadOpenInvite(token);
    if (!invite || !isUuid(sessionId)) return interviewerJson({ error: "This link is not available." }, 404);
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
