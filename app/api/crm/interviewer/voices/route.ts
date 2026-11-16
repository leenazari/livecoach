import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { INTERVIEWER_VOICES, isInterviewerVoiceId } from "@/lib/interviewer/voices";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

function missing(error: { message?: string } | null): boolean {
  return Boolean(error && /does not exist|schema cache|could not find the table/i.test(error.message || ""));
}

export async function GET() {
  try {
    const scope = await requireInterviewerOwner();
    const { data, error } = await supabaseService
      .from("interviewer_voice_shortlist")
      .select("voice_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId);
    if (error) {
      return NextResponse.json({
        voices: INTERVIEWER_VOICES,
        shortlist: [],
        ready: false,
        note: missing(error) ? "The voice shortlist is not in this database yet." : "The shortlist could not be read.",
      }, { headers: noStore });
    }
    return NextResponse.json({
      voices: INTERVIEWER_VOICES,
      shortlist: (data || []).map((row) => row.voice_id).filter((id) => isInterviewerVoiceId(id)),
      ready: true,
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const body = await req.json().catch(() => ({}));
    const voiceIds = Array.isArray(body?.voiceIds)
      ? [...new Set(body.voiceIds.map((id: unknown) => String(id)).filter((id: string) => isInterviewerVoiceId(id)))]
      : [];
    const removed = await supabaseService
      .from("interviewer_voice_shortlist")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId);
    if (removed.error) {
      return NextResponse.json({
        ready: false,
        saved: false,
        shortlist: voiceIds,
        note: missing(removed.error)
          ? "The shortlist table is not in this database yet. Your ticks stay on this page only."
          : "The shortlist could not be saved.",
      }, { headers: noStore });
    }
    if (voiceIds.length) {
      const { error } = await supabaseService.from("interviewer_voice_shortlist").insert(
        voiceIds.map((voiceId) => ({ workspace_id: scope.workspaceId, owner_id: scope.userId, voice_id: voiceId }))
      );
      if (error) throw error;
    }
    return NextResponse.json({ ready: true, saved: true, shortlist: voiceIds }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
