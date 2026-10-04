import "server-only";

import { NextRequest } from "next/server";

import { POST as startBot } from "@/app/api/meet/start/route";
import { validMeetingUrl } from "@/lib/meeting-url";
import { privateRecordFields, resolveRecordScope } from "@/lib/record-scope";
import { precallScheduleAction } from "@/lib/precall-schedule";
import { cancelScheduledNotetakers } from "@/lib/recall-scheduled-bot";
import { scheduledCallSessionId } from "@/lib/scheduled-call-session";
import { supabaseAdmin } from "@/lib/supabase";

type UpcomingCall = {
  id: string;
  company_id: string | null;
  workstream_id: string | null;
  title: string | null;
  scheduled_at: string;
  meeting_url: string | null;
  intent: string | null;
  completed_at: string | null;
  prep: Record<string, any> | null;
};

const internalPost = (path: string, body: unknown) =>
  new NextRequest(new URL(path, "https://livecoach.internal"), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function scheduleOne(call: UpcomingCall) {
  const sessionId = scheduledCallSessionId(call.id);
  if (!sessionId || !validMeetingUrl(call.meeting_url)) {
    return { outcome: "skipped" as const, code: "invalid_meeting_link" };
  }

  const scope = await resolveRecordScope();
  const prep = call.prep || {};
  // Seed an unattended call once. Calendar refresh must not replace the role,
  // focus or other prep the salesperson has saved in the existing session.
  const { error: sessionError } = await supabaseAdmin
    .from("interview_sessions")
    .upsert({
      ...privateRecordFields(scope),
      session_id: sessionId,
      brief: call.intent || prep.brief || null,
      role: prep.role || null,
      call_type: prep.callType || "general",
      competencies: Array.isArray(prep.selectedComps) ? prep.selectedComps : [],
      candidate: prep.candidate || call.title || "Scheduled call",
      source: "meet",
      company_id: call.company_id,
      workstream_id: call.workstream_id,
      upcoming_id: call.id,
      started_at: call.scheduled_at,
    }, { onConflict: "owner_id,session_id", ignoreDuplicates: true });
  if (sessionError) {
    return { outcome: "failed" as const, code: "session_not_persisted" };
  }

  const botResponse = await startBot(
    internalPost("/api/meet/start", {
      meetingUrl: call.meeting_url,
      sessionId,
      upcomingId: call.id,
      autoStart: true,
    })
  );
  const result = await botResponse.json().catch(() => ({}));
  if (!botResponse.ok) {
    return {
      outcome: "failed" as const,
      code: String(result?.code || `bot_start_${botResponse.status}`).slice(
        0,
        80
      ),
    };
  }
  return {
    outcome: result?.status === "scheduled" ? ("scheduled" as const) : ("started" as const),
    code: String(result?.status || "accepted"),
  };
}

export async function scheduleAutomaticNotetakersForUpcomingIds(
  upcomingIds: string[]
) {
  const scope = await resolveRecordScope();
  const ids = Array.from(new Set(upcomingIds.filter(Boolean))).slice(0, 500);
  if (!ids.length) {
    return { eligible: 0, scheduled: 0, started: 0, skipped: 0, failed: 0, failureCodes: [] as string[] };
  }

  const { data, error } = await supabaseAdmin
    .from("upcoming_calls")
    .select(
      "id,company_id,workstream_id,title,scheduled_at,meeting_url,intent,completed_at,prep"
    )
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .in("id", ids);
  if (error) throw error;

  const now = Date.now();
  const calls = (data || []) as UpcomingCall[];
  const eligible: UpcomingCall[] = [];
  const cancelIds: string[] = [];
  for (const call of calls) {
    const action = precallScheduleAction({
      scheduledAt: call.scheduled_at,
      completed: Boolean(call.completed_at),
      supportedLink: validMeetingUrl(call.meeting_url),
      nowMs: now,
    });
    if (action === "cancel") {
      cancelIds.push(call.id);
      continue;
    }
    eligible.push(call);
  }
  if (cancelIds.length) {
    await cancelScheduledNotetakers({
      workspaceId: scope.workspaceId,
      ownerId: scope.userId,
      upcomingIds: cancelIds,
    });
  }

  const results: Awaited<ReturnType<typeof scheduleOne>>[] = [];
  const concurrency = 6;
  for (let index = 0; index < eligible.length; index += concurrency) {
    results.push(
      ...(await Promise.all(eligible.slice(index, index + concurrency).map(async (call) => {
        try {
          return await scheduleOne(call);
        } catch (error) {
          console.error("notetaker reservation failed", error);
          return { outcome: "failed" as const, code: "notetaker_schedule_failed" };
        }
      })))
    );
  }

  const failureCodes = Array.from(
    new Set(
      results
        .filter((result) => result.outcome === "failed")
        .map((result) => result.code)
    )
  );
  return {
    eligible: eligible.length,
    scheduled: results.filter((result) => result.outcome === "scheduled").length,
    started: results.filter((result) => result.outcome === "started").length,
    skipped: calls.length - eligible.length,
    failed: results.filter((result) => result.outcome === "failed").length,
    failureCodes,
  };
}
