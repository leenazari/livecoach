import { raiseInterviewerError } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { isDuplicateUtterance } from "@/lib/interviewer/listen-transcript";
import { linkedSession } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Incoming = {
  speaker?: unknown;
  text?: unknown;
  ts?: unknown;
  utteranceId?: unknown;
  clientKey?: unknown;
};

type Stored = { speaker: string; text: string; ts: string; client_key: string | null };

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const linked = await linkedSession(String(body.token || ""), String(body.sessionId || ""));
    if (!linked) return interviewerJson({ error: "This link is not available." }, 404);
    const incoming = Array.isArray(body.utterances) ? body.utterances as Incoming[] : [];
    const rows = incoming.slice(0, 20).flatMap((item) => {
      const speaker = item.speaker === "agent" || item.speaker === "lead" ? item.speaker : null;
      const text = String(item.text || "").trim().slice(0, 4000);
      const utteranceId = String(item.utteranceId || item.clientKey || "").trim();
      if (!speaker || !text || utteranceId.length < 8 || utteranceId.length > 80) return [];
      const ts = typeof item.ts === "string" && Number.isFinite(Date.parse(item.ts))
        ? item.ts
        : new Date().toISOString();
      return [{
        workspace_id: linked.session.workspace_id,
        session_id: linked.session.id,
        speaker,
        text,
        ts,
        client_key: utteranceId,
      }];
    });
    if (!rows.length) return interviewerJson({ saved: 0, duplicate: 0 });

    const { data: recent, error: recentError } = await supabaseService
      .from("interviewer_utterances")
      .select("speaker, text, ts, client_key")
      .eq("session_id", linked.session.id)
      .order("ts", { ascending: false })
      .limit(40);
    raiseInterviewerError(recentError);
    const seen: Stored[] = (recent || []) as Stored[];
    let saved = 0;
    let duplicate = 0;

    for (const row of rows) {
      const already = seen.find((item) => item.client_key === row.client_key);
      if (already) {
        if (already.text === row.text) {
          duplicate += 1;
          continue;
        }
        const { error } = await supabaseService
          .from("interviewer_utterances")
          .update({ text: row.text, ts: row.ts })
          .eq("session_id", linked.session.id)
          .eq("client_key", row.client_key);
        if (error && /42501|permission/i.test(`${error.code || ""} ${error.message || ""}`)) {
          duplicate += 1;
          continue;
        }
        raiseInterviewerError(error);
        already.text = row.text;
        already.ts = row.ts;
        saved += 1;
        continue;
      }
      if (isDuplicateUtterance(seen, row)) {
        duplicate += 1;
        continue;
      }
      const { error } = await supabaseService.from("interviewer_utterances").insert(row);
      if (error && /23505|duplicate/i.test(`${error.code || ""} ${error.message || ""}`)) {
        duplicate += 1;
        continue;
      }
      raiseInterviewerError(error);
      seen.unshift(row);
      saved += 1;
    }
    return interviewerJson({ saved, duplicate });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
