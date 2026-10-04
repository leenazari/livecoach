import { NextRequest, NextResponse } from "next/server";

import { POST as syncCalendar } from "@/app/api/crm/calendar-sync/route";
import { POST as persistSession } from "@/app/api/interview/session/route";
import { POST as startBot } from "@/app/api/meet/start/route";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { validMeetingUrl } from "@/lib/meeting-url";
import { resolveRecordScope } from "@/lib/record-scope";
import { scheduledCallSessionId } from "@/lib/scheduled-call-session";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AUTO_JOIN_AHEAD_MS = 5 * 60 * 1000 + 30_000;
const LATE_CATCH_UP_MS = 2 * 60 * 1000;
const MAX_CALLS_PER_ACCOUNT = 20;

type UpcomingCall = {
  id: string;
  company_id: string | null;
  workstream_id: string | null;
  title: string | null;
  scheduled_at: string;
  meeting_url: string | null;
  intent: string | null;
  source: string | null;
};

const internalPost = (request: NextRequest, path: string, body?: unknown) =>
  new NextRequest(new URL(path, request.url), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function runAccount(request: NextRequest) {
  const scope = await resolveRecordScope();

  // Refresh only the next two hours before deciding what to dispatch. This
  // catches a late invite and safely reconciles cancellations inside that
  // bounded window without running the 30-day refresh every minute. Explicitly
  // dismissed events stay excluded by the canonical calendar-sync path.
  const calendarResponse = await syncCalendar(
    internalPost(request, "/api/crm/calendar-sync?mode=near-term")
  );
  const calendarResult = await calendarResponse.json().catch(() => ({}));

  const now = Date.now();
  const from = new Date(now - LATE_CATCH_UP_MS).toISOString();
  const to = new Date(now + AUTO_JOIN_AHEAD_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("upcoming_calls")
    .select(
      "id,company_id,workstream_id,title,scheduled_at,meeting_url,intent,source"
    )
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .is("completed_at", null)
    .not("meeting_url", "is", null)
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .order("scheduled_at", { ascending: true })
    .limit(MAX_CALLS_PER_ACCOUNT);
  if (error) throw error;

  const calendarFresh = calendarResponse.ok && calendarResult?.ok === true;
  const candidates = ((data || []) as UpcomingCall[]).filter((call) =>
    validMeetingUrl(call.meeting_url)
  );
  const staleCalendarDeferred = candidates.filter((call) => {
    const calendarOwned = call.source === "google" || call.source === "microsoft";
    return calendarOwned && !calendarFresh;
  }).length;
  // Do not auto-join a possibly cancelled provider meeting from stale local
  // data. Manual CRM calls do not depend on a calendar refresh.
  const calls = candidates.filter((call) => {
    const calendarOwned = call.source === "google" || call.source === "microsoft";
    return !calendarOwned || calendarFresh;
  });
  let started = 0;
  let attached = 0;
  let alreadyDispatched = 0;
  let deferred = staleCalendarDeferred;
  let failed = 0;
  const failureCodes: string[] = [];

  // One account cannot safely run two simultaneous private coaching sessions.
  // Work in scheduled order and let the start endpoint defer a back-to-back
  // call until the previous subscription has ended.
  for (const call of calls) {
    const sessionId = scheduledCallSessionId(call.id);
    if (!sessionId || !call.meeting_url) {
      failed += 1;
      failureCodes.push("invalid_scheduled_call");
      continue;
    }

    const { data: prior, error: priorError } = await supabaseAdmin
      .from("meet_capture_subscribers")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("upcoming_id", call.id)
      .limit(1)
      .maybeSingle();
    if (priorError) throw priorError;
    if (prior) {
      alreadyDispatched += 1;
      continue;
    }

    const sessionResponse = await persistSession(
      internalPost(request, "/api/interview/session", {
        sessionId,
        brief: call.intent,
        role: null,
        callType: "general",
        competencies: [],
        candidate: call.title || "Scheduled call",
        source: "meet",
        companyId: call.company_id,
        workstreamId: call.workstream_id,
        upcomingId: call.id,
      })
    );
    if (!sessionResponse.ok) {
      failed += 1;
      failureCodes.push("session_not_persisted");
      continue;
    }

    const botResponse = await startBot(
      internalPost(request, "/api/meet/start", {
        meetingUrl: call.meeting_url,
        sessionId,
        upcomingId: call.id,
        autoStart: true,
      })
    );
    const botResult = await botResponse.json().catch(() => ({}));
    if (botResponse.ok) {
      if (
        botResult?.status === "shared_active" ||
        botResult?.status === "already_active"
      ) {
        attached += 1;
      } else {
        started += 1;
      }
      continue;
    }
    if (
      botResponse.status === 409 &&
      botResult?.code === "transcriber_already_active"
    ) {
      deferred += 1;
      continue;
    }
    failed += 1;
    failureCodes.push(
      String(botResult?.code || `bot_start_${botResponse.status}`).slice(0, 80)
    );
  }

  return {
    calendarRefreshed: calendarFresh,
    calendarStatus: calendarResponse.status,
    eligible: candidates.length,
    started,
    attached,
    alreadyDispatched,
    deferred,
    failed,
    failureCodes: Array.from(new Set(failureCodes)),
  };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (
    !secret ||
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  try {
    // Include active members without a connected calendar as well. They may
    // still have a manually created CRM call with a valid meeting link.
    const accounts = await listActiveAccountScopes();
    const results = await Promise.all(
      accounts.map(async (account) => {
        try {
          return await runWithServiceRecordScope(account, () =>
            runAccount(request)
          );
        } catch (error) {
          console.error("automatic pre-call dispatch account failed", error);
          return {
            calendarRefreshed: false,
            calendarStatus: 500,
            eligible: 0,
            started: 0,
            attached: 0,
            alreadyDispatched: 0,
            deferred: 0,
            failed: 1,
            failureCodes: ["account_failed"],
          };
        }
      })
    );
    return NextResponse.json({
      ok: results.every((result) => result.failed === 0),
      accounts: results.length,
      eligible: results.reduce((sum, result) => sum + result.eligible, 0),
      started: results.reduce((sum, result) => sum + result.started, 0),
      attached: results.reduce((sum, result) => sum + result.attached, 0),
      alreadyDispatched: results.reduce(
        (sum, result) => sum + result.alreadyDispatched,
        0
      ),
      deferred: results.reduce((sum, result) => sum + result.deferred, 0),
      failed: results.reduce((sum, result) => sum + result.failed, 0),
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Automatic pre-call dispatch failed" },
      { status: 500 }
    );
  }
}
