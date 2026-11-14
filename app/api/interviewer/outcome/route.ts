import {
  dispositionNeedsReason,
  isInterviewerDisposition,
  isTimingPrecision,
} from "@/lib/interviewer/dispositions";
import { raiseInterviewerError } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const linked = await linkedSession(String(body.token || ""), String(body.sessionId || ""));
    if (!linked) return interviewerJson({ error: "This link is not available." }, 404);
    const patch: Record<string, unknown> = {};
    if (body.disposition !== undefined) {
      if (!isInterviewerDisposition(body.disposition)) {
        return interviewerJson({ saved: false, note: "That outcome is not one of the allowed dispositions." });
      }
      const reason = String(body.reasonCode || body.reason_code || "").trim().slice(0, 160);
      if (dispositionNeedsReason(body.disposition) && !reason) {
        return interviewerJson({ saved: false, note: "That outcome needs a short reason code." });
      }
      patch.disposition = body.disposition;
      patch.reason_code = reason || null;
    }
    if (body.timingPrecision !== undefined || body.timing_precision !== undefined || body.timingRawQuote !== undefined || body.timing_raw_quote !== undefined) {
      const precision = body.timingPrecision ?? body.timing_precision;
      if (!isTimingPrecision(precision)) {
        return interviewerJson({ saved: false, note: "The timing needs a precision of day, week, month, quarter, year or unknown." });
      }
      patch.timing_precision = precision;
      patch.timing_raw_quote = String(body.timingRawQuote || body.timing_raw_quote || "").trim().slice(0, 500) || null;
      patch.timing_target_date = dateOrNull(body.timingTargetDate ?? body.timing_target_date);
    }
    if (!Object.keys(patch).length) return interviewerJson({ saved: false, note: "Nothing was recorded." });
    const { error } = await supabaseService.from("interviewer_sessions").update(patch).eq("id", linked.session.id);
    raiseInterviewerError(error);
    return interviewerJson({ saved: true });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
