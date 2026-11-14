import { raiseInterviewerError } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Incoming = { speaker?: unknown; text?: unknown; ts?: unknown; clientKey?: unknown };

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const linked = await linkedSession(String(body.token || ""), String(body.sessionId || ""));
    if (!linked) return interviewerJson({ error: "This link is not available." }, 404);
    const incoming = Array.isArray(body.utterances) ? body.utterances as Incoming[] : [];
    const rows = incoming.slice(0, 20).flatMap((item) => {
      const speaker = item.speaker === "agent" || item.speaker === "lead" ? item.speaker : null;
      const text = String(item.text || "").trim().slice(0, 4000);
      const clientKey = String(item.clientKey || "").trim();
      if (!speaker || !text || clientKey.length < 8 || clientKey.length > 80) return [];
      const ts = typeof item.ts === "string" && Number.isFinite(Date.parse(item.ts)) ? item.ts : new Date().toISOString();
      return [{
        workspace_id: linked.session.workspace_id,
        session_id: linked.session.id,
        speaker,
        text,
        ts,
        client_key: clientKey,
      }];
    });
    if (!rows.length) return interviewerJson({ saved: 0 });
    let saved = 0;
    for (const row of rows) {
      const { error } = await supabaseService.from("interviewer_utterances").insert(row);
      if (error && !/23505|duplicate/i.test(`${error.code || ""} ${error.message || ""}`)) {
        raiseInterviewerError(error);
      }
      if (!error) saved += 1;
    }
    return interviewerJson({ saved });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
