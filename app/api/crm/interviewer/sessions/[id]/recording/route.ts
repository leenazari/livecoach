import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { supabaseService } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const scope = await requireInterviewerOwner();
    const { data: session, error } = await supabaseAdmin
      .from("interviewer_sessions")
      .select("id, recording_path")
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!session?.recording_path) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_recording_missing",
        title: "Recording unavailable",
        reason: "This conversation does not have a saved recording yet.",
        nextAction: "Check the transcript. If the call has just finished, reload once before assuming the recording is missing.",
        responsible: "owner",
      }), { status: 404, headers: noStore });
    }
    const signed = await supabaseService.storage
      .from("interviewer-recordings")
      .createSignedUrl(session.recording_path, 60 * 30);
    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_recording_unreadable",
        title: "Recording could not be opened",
        reason: "The recording file is listed, but a playback link could not be prepared.",
        nextAction: "Reload the conversation. The transcript is still available if it was saved.",
        responsible: "system",
      }), { status: 502, headers: noStore });
    }
    return NextResponse.json({ url: signed.data.signedUrl }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
