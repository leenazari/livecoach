import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession } from "@/lib/interviewer/queue-view";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 104857600;

function recordingPath(workspaceId: string, sessionId: string) {
  return `${workspaceId}/${sessionId}.webm`;
}

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const linked = await linkedSession(String(body.token || ""), String(body.sessionId || ""));
    if (!linked) return interviewerJson({ error: "This link is not available." }, 404);
    const fileSize = Number(body.fileSize);
    if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > MAX_BYTES) {
      return interviewerJson({ error: "The recording is empty or larger than 100 MB." }, 413);
    }
    const path = recordingPath(linked.session.workspace_id, linked.session.id);
    const { data, error } = await supabaseService.storage
      .from("interviewer-recordings")
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data?.signedUrl) {
      console.error("interviewer recording upload could not be signed");
      return interviewerJson({ error: "The recording store is not ready. The transcript can still be kept." }, 503);
    }
    return interviewerJson({ path, signedUrl: data.signedUrl, token: data.token });
  } catch (error) {
    return interviewerPublicError(error);
  }
}
