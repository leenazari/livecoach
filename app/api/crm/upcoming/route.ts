import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import {
  calendarDurationMinutes,
  parseCalendarAttendees,
  validCalendarRequestId,
} from "@/lib/calendar-create";
import { createConnectedCalendarEvent } from "@/lib/calendar-provider";
import { privateRecordFields, resolveRecordScope } from "@/lib/record-scope";
import { validMeetingUrl } from "@/lib/meeting-url";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
// Keep this a dynamic function: a no-arg GET would otherwise be statically
// optimised and the POST would 405 (INVALID_REQUEST_METHOD) at the edge.
export const dynamic = "force-dynamic";

// GET /api/crm/upcoming -> scheduled calls, soonest first, with the linked
// company name. Powers the dashboard's Upcoming Calls card.
export async function GET() {
  try {
    const scope = await resolveRecordScope();
    // Hide calls whose time has passed by more than a short grace window (3h),
    // so a just-finished call sticks around long enough to open/recap, then
    // drops off on its own. Calls with no set time are always kept.
    const pastCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    // Keep a short recovery window for calls marked done. This lets the user
    // reopen an accidentally hidden call without exposing another person's
    // calendar or duplicating the source event.
    const recoveryCutoff = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000
    ).toISOString();
    const nowIso = new Date().toISOString();
    const [
      companiesResult,
      callsResult,
      recentlyCompletedResult,
      callRemindersResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id, name")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId),
      supabaseAdmin
        .from("upcoming_calls")
        .select(
          "id, company_id, title, scheduled_at, meeting_url, intent, prepped, source, created_at"
        )
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        // A finished call (completed_at set on end) drops off here at once.
        .is("completed_at", null)
        .or(`scheduled_at.is.null,scheduled_at.gte.${pastCutoff}`)
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .limit(200),
      supabaseAdmin
        .from("upcoming_calls")
        .select(
          "id, company_id, title, scheduled_at, meeting_url, intent, prepped, source, created_at, completed_at"
        )
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .not("completed_at", "is", null)
        // Always include a future call, even if it was hidden more than two
        // weeks ago. Otherwise keep the recovery list deliberately short.
        .or(`completed_at.gte.${recoveryCutoff},scheduled_at.gte.${nowIso}`)
        .order("completed_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("tasks")
        .select("id,text,due_at,created_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("status", "open")
        .eq("link_kind", "call")
        .not("due_at", "is", null)
        .order("due_at", { ascending: true })
        .limit(100),
    ]);
    const firstError = [
      companiesResult.error,
      callsResult.error,
      recentlyCompletedResult.error,
      callRemindersResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;
    const companies = companiesResult.data || [];
    const calls = callsResult.data || [];
    const recentlyCompleted = recentlyCompletedResult.data || [];
    const callReminders = callRemindersResult.data || [];
    const nameById = new Map<string, string>();
    for (const c of companies) nameById.set(c.id, c.name);
    const items = calls
      .filter((c: any) => isPrepEligibleCalendarEvent(c))
      .map((c: any) => ({
        ...c,
        company: c.company_id ? nameById.get(c.company_id) || null : null,
      }));
    const recoverable = recentlyCompleted
      .filter((c: any) => isPrepEligibleCalendarEvent(c))
      .map((c: any) => ({
        ...c,
        company: c.company_id ? nameById.get(c.company_id) || null : null,
      }));
    return NextResponse.json(
      {
        calls: items,
        callReminders: callReminders.map((reminder: any) => ({
          id: reminder.id,
          text: reminder.text,
          dueAt: reminder.due_at,
          createdAt: reminder.created_at,
        })),
        recentlyCompleted: recoverable,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json(
      crmBlockerPayload({
        code: "calls_and_reminders_unavailable",
        title: "Calls and reminders could not be loaded",
        reason: "LiveCoach could not safely read your personal calls and reminders",
        nextAction:
          "Refresh Calls and try once. If it repeats, send the blocker code to a workspace owner",
        responsible: "system",
      }),
      { status: 500 }
    );
  }
}

// POST /api/crm/upcoming -> schedule a new call. When addToCalendar is true,
// create the real event first and store its canonical provider identity on the
// same private upcoming_calls row. A browser retry reuses requestId, so Google
// and Microsoft can suppress duplicate events.
export async function POST(req: NextRequest) {
  try {
    const scope = await resolveRecordScope();
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const companyId =
      typeof body.companyId === "string" && body.companyId.trim()
        ? body.companyId.trim()
        : null;
    if (!title && !companyId) {
      return NextResponse.json(
        { error: "give the call a title or a client" },
        { status: 400 }
      );
    }

    let companyName = "";
    if (companyId) {
      const { data: company, error: companyError } = await supabaseAdmin
        .from("companies")
        .select("id,name")
        .eq("id", companyId)
        .maybeSingle();
      if (companyError) throw companyError;
      if (!company?.id) {
        return NextResponse.json(
          { error: "That client is not available to this account" },
          { status: 400 }
        );
      }
      companyName = String(company.name || "").trim();
    }

    const addToCalendar = body.addToCalendar === true;
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (addToCalendar && !validCalendarRequestId(requestId)) {
      return NextResponse.json(
        { error: "Refresh the form and try creating the calendar event again" },
        { status: 400 }
      );
    }

    const scheduledAt =
      typeof body.scheduledAt === "string" && body.scheduledAt
        ? new Date(body.scheduledAt)
        : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json(
        { error: "Choose a valid date and time" },
        { status: 400 }
      );
    }
    if (addToCalendar && !scheduledAt) {
      return NextResponse.json(
        { error: "Choose a date and time before adding this to your calendar" },
        { status: 400 }
      );
    }

    const meetingUrl =
      typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
    if (meetingUrl && !validMeetingUrl(meetingUrl)) {
      return NextResponse.json(
        { error: "Use a valid Meet, Teams, Zoom or supported meeting link" },
        { status: 400 }
      );
    }

    const attendeeResult = parseCalendarAttendees(body.attendeeEmails);
    if (attendeeResult.invalid.length) {
      return NextResponse.json(
        {
          error: `Check these guest emails: ${attendeeResult.invalid
            .slice(0, 3)
            .join(", ")}`,
        },
        { status: 400 }
      );
    }

    const eventTitle = title || `Call with ${companyName || "client"}`;
    const durationMinutes = calendarDurationMinutes(body.durationMinutes);
    const startIso = scheduledAt?.toISOString() || null;
    const endIso = startIso
      ? new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString()
      : null;
    const calendarEvent =
      addToCalendar && startIso && endIso
        ? await createConnectedCalendarEvent({
            requestId,
            title: eventTitle,
            startIso,
            endIso,
            attendeeEmails: attendeeResult.emails,
            meetingUrl: meetingUrl || null,
          })
        : null;

    const { data, error } = await supabaseAdmin
      .from("upcoming_calls")
      .insert({
        ...privateRecordFields(scope),
        company_id: companyId,
        title: eventTitle,
        scheduled_at: calendarEvent?.scheduledAt || startIso,
        meeting_url: calendarEvent?.meetingUrl || meetingUrl || null,
        intent:
          typeof body.intent === "string" && body.intent.trim()
            ? body.intent.trim()
            : null,
        prepped: false,
        source: calendarEvent?.provider || "manual",
        external_id: calendarEvent?.externalId || null,
        attendees: calendarEvent?.attendees || attendeeResult.emails.map((email) => ({
          email,
          displayName: email,
          self: false,
          responseStatus: "needsAction",
        })),
      })
      .select(
        "id,company_id,title,scheduled_at,meeting_url,intent,prepped,source,external_id,attendees"
      )
      .single();
    if (error) {
      if (calendarEvent?.externalId) {
        const { data: existing } = await supabaseAdmin
          .from("upcoming_calls")
          .select(
            "id,company_id,title,scheduled_at,meeting_url,intent,prepped,source,external_id,attendees"
          )
          .eq("owner_id", scope.userId)
          .eq("external_id", calendarEvent.externalId)
          .maybeSingle();
        if (existing?.id) {
          return NextResponse.json({
            ok: true,
            id: existing.id,
            call: existing,
            provider: calendarEvent.provider,
            calendarCreated: true,
            invitesSent: attendeeResult.emails.length,
            reused: true,
          });
        }
        return NextResponse.json(
          {
            error:
              "The calendar event was created, but LiveCoach could not save its CRM record. Press Sync to recover it.",
            calendarCreated: true,
            provider: calendarEvent.provider,
          },
          { status: 502 }
        );
      }
      throw error;
    }
    return NextResponse.json({
      ok: true,
      id: data?.id,
      call: data,
      provider: calendarEvent?.provider || null,
      calendarCreated: !!calendarEvent,
      invitesSent: calendarEvent ? attendeeResult.emails.length : 0,
      reused: false,
    });
  } catch (err: any) {
    const message = err?.message || "failed to schedule the call";
    const reconnectOrInput = /connect|reconnect|valid|calendar request/i.test(message);
    return NextResponse.json(
      { error: message },
      { status: reconnectOrInput ? 400 : 500 }
    );
  }
}
