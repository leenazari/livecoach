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
    const result = await interviewerRpc<{ ok?: boolean; billableSeconds?: number; billedAmount?: number | null }>(
      "end_interviewer_session",
      { p_token: token, p_session_id: sessionId }
    );
    return interviewerJson({
      state: "ended",
      billableSeconds: Number(result?.billableSeconds || 0),
      billedAmount: result?.billedAmount ?? null,
      currency: null,
    });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
