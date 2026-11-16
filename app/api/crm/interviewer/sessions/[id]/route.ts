import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { crmBlockerPayload } from "@/lib/crm-blocker";
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
      .select("id, campaign_id, status, started_at, connected_at, ended_at, billable_seconds, billed_amount, disposition, reason_code, timing_target_date, timing_precision, timing_raw_quote, calendar_event_id, calendar_scheduled_at, recording_path")
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (error) throw error;
    if (!session) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_session_missing",
        title: "Conversation unavailable",
        reason: "That conversation is not on your account.",
        nextAction: "Reload the interviewer page and choose a conversation from the list.",
        responsible: "owner",
      }), { status: 404, headers: noStore });
    }
    const { data: utterances, error: utteranceError } = await supabaseAdmin
      .from("interviewer_utterances")
      .select("id, speaker, text, ts")
      .eq("session_id", session.id)
      .order("ts", { ascending: true })
      .limit(500);
    if (utteranceError) throw utteranceError;
    return NextResponse.json({
      session: { ...session, hasRecording: Boolean(session.recording_path), recording_path: undefined },
      utterances: utterances || [],
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
