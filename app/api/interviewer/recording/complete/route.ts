import { raiseInterviewerError } from "@/lib/interviewer/data";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const linked = await linkedSession(String(body.token || ""), String(body.sessionId || ""));
    if (!linked) return interviewerJson({ error: "This link is not available." }, 404);
    const expected = `${linked.session.workspace_id}/${linked.session.id}.webm`;
    if (body.path !== expected) return interviewerJson({ error: "That recording does not belong to this conversation." }, 400);
    const { error } = await supabaseService
      .from("interviewer_sessions")
      .update({ recording_path: expected })
      .eq("id", linked.session.id);
    raiseInterviewerError(error);
    return interviewerJson({ saved: true });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
