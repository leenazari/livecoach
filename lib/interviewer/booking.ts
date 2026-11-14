import "server-only";

import { createConnectedCalendarEvent } from "@/lib/calendar-provider";
import { normaliseReplyMeetingRequest } from "@/lib/reply-meeting-options";
import { suggestReplyMeetingOptions } from "@/lib/reply-calendar";
import { getSalesProfile } from "@/lib/sales-profile";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { supabaseService } from "@/lib/supabase";

import { InterviewerDataError } from "@/lib/interviewer/data";

export type MeetingSlot = { start: string; end: string; label: string };

function cleanEmail(value: string | null): string | null {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function suggestForOwner(input: {
  ownerId: string;
  workspaceId: string;
  durationMinutes?: number;
  timeOfDay?: string;
  fromDate?: string | null;
  toDate?: string | null;
}) {
  const scope = { userId: input.ownerId, workspaceId: input.workspaceId };
  return runWithServiceRecordScope(scope, async () => {
    const profile = await getSalesProfile(scope);
    const request = normaliseReplyMeetingRequest({
      requested: true,
      durationMinutes: input.durationMinutes,
      fromDate: input.fromDate || null,
      toDate: input.toDate || null,
      weekdays: [],
      timeOfDay: input.timeOfDay,
    });
    const options = await suggestReplyMeetingOptions(scope, profile, request);
    return {
      status: options.status,
      note: options.note,
      slots: options.slots.map((slot) => ({ start: slot.start, end: slot.end, label: slot.label })),
    };
  });
}

export async function suggestInterviewerMeetings(input: {
  ownerId: string;
  workspaceId: string;
  durationMinutes?: number;
  timeOfDay?: string;
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<{ status: string; note: string; slots: MeetingSlot[] }> {
  try {
    return await suggestForOwner(input);
  } catch (error) {
    console.error("interviewer calendar suggest failed", {
      message: error instanceof Error ? error.message.slice(0, 180) : "unknown",
    });
    return {
      status: "unavailable",
      note: "The connected calendar could not be checked. No times have been invented.",
      slots: [],
    };
  }
}

export async function bookInterviewerMeeting(input: {
  sessionId: string;
  ownerId: string;
  workspaceId: string;
  campaignName: string;
  prospectName: string | null;
  prospectEmail: string | null;
  start: string;
  end: string;
}): Promise<{ booked: boolean; saved?: boolean; note: string; scheduledAt?: string; eventId?: string; slots?: MeetingSlot[] }> {
  const startMs = Date.parse(input.start);
  const endMs = Date.parse(input.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { booked: false, note: "That time was not a real slot." };
  }

  const { data: existing, error: existingError } = await supabaseService
    .from("interviewer_sessions")
    .select("calendar_event_id, calendar_scheduled_at")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (existingError) throw new InterviewerDataError("The booking could not be checked.", "unavailable");
  if (existing?.calendar_event_id) {
    return {
      booked: true,
      note: "This conversation already has a meeting on the calendar.",
      eventId: String(existing.calendar_event_id),
      scheduledAt: existing.calendar_scheduled_at || undefined,
    };
  }

  const durationMinutes = Math.round((endMs - startMs) / 60000);
  const suggestion = await suggestForOwner({
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    durationMinutes: durationMinutes >= 10 && durationMinutes <= 120 ? durationMinutes : 30,
  });
  const match = suggestion.slots.find((slot) => Math.abs(Date.parse(slot.start) - startMs) < 60_000);
  if (!match) {
    return {
      booked: false,
      note: suggestion.note || "That time is not free on the connected calendar.",
      slots: suggestion.slots,
    };
  }

  // No attendee email is sent. The event is placed on the owner's own calendar
  // so this slice does not email the prospect. Inviting them needs approval.
  const created = await runWithServiceRecordScope(
    { userId: input.ownerId, workspaceId: input.workspaceId },
    () => createConnectedCalendarEvent(
      {
        requestId: input.sessionId,
        title: `Interviewer: ${input.prospectName?.trim() || "Guest"} — ${input.campaignName}`.slice(0, 180),
        startIso: match.start,
        endIso: match.end,
        attendeeEmails: [],
        meetingUrl: null,
      },
      input.ownerId
    )
  );

  const { error: saveError } = await supabaseService
    .from("interviewer_sessions")
    .update({
      calendar_event_id: created.externalId,
      calendar_scheduled_at: created.scheduledAt,
    })
    .eq("id", input.sessionId)
    .is("calendar_event_id", null);
  if (saveError) {
    console.error("interviewer booking saved on the calendar but not on the session");
    return {
      booked: true,
      saved: false,
      note: "The meeting was created on the connected calendar, but the conversation record did not confirm it. Check the calendar before booking again.",
      eventId: created.externalId,
      scheduledAt: created.scheduledAt,
    };
  }

  return {
    booked: true,
    saved: true,
    note: `Booked for ${match.label}. It is on the connected calendar.`,
    eventId: created.externalId,
    scheduledAt: created.scheduledAt,
  };
}

export function prospectEmailOrNull(value: string | null): string | null {
  return cleanEmail(value);
}
