import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const campaignId = new URL(req.url).searchParams.get("campaignId") || "";
    let query = supabaseAdmin
      .from("interviewer_sessions")
      .select("id, campaign_id, status, started_at, connected_at, ended_at, billable_seconds, billed_amount, disposition, reason_code, timing_target_date, timing_precision, timing_raw_quote, recording_path, calendar_event_id, calendar_scheduled_at, created_at")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (/^[0-9a-f-]{36}$/i.test(campaignId)) query = query.eq("campaign_id", campaignId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({
      sessions: (data || []).map((session) => ({
        ...session,
        hasRecording: Boolean(session.recording_path),
        recording_path: undefined,
      })),
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
