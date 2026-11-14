import { loadOrCreateBrief } from "@/lib/interviewer/brief-store";
import { PLACEHOLDER_OUTCOME, dispositionFromIntent, leadRecap } from "@/lib/interviewer/call-close";
import { recordSessionCost } from "@/lib/interviewer/cost-store";
import { interviewerRpc, isUuid, loadOpenInvite } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { supabaseService } from "@/lib/supabase";

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
    await recordSessionCost(sessionId).catch(() => undefined);
    const brief = await loadOrCreateBrief(sessionId).catch(() => null);
    const { data: finished } = await supabaseService
      .from("interviewer_sessions")
      .select("disposition, reason_code")
      .eq("id", sessionId)
      .maybeSingle();
    const placeholder = !finished?.disposition || finished.reason_code === PLACEHOLDER_OUTCOME;
    if (brief && placeholder) {
      const outcome = dispositionFromIntent(brief.intent.label, brief.intent.reasons);
      await supabaseService
        .from("interviewer_sessions")
        .update({ disposition: outcome.disposition, reason_code: outcome.reason })
        .eq("id", sessionId);
    }
    return interviewerJson({
      state: "ended",
      billableSeconds: Number(result?.billableSeconds || 0),
      billedAmount: result?.billedAmount ?? null,
      currency: null,
      recap: brief ? leadRecap(brief) : null,
    });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
