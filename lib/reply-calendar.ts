import "server-only";
import { listConnectedCalendarAvailability } from "@/lib/calendar-provider";
import { busyIntervals, chooseReplyMeetingSlots, type ReplyMeetingOptions, type ReplyMeetingRequest } from "@/lib/reply-meeting-options";
import type { SalesProfile } from "@/lib/sales-profile-types";
import type { RecordScope } from "@/lib/record-scope";

export async function suggestReplyMeetingOptions(scope: RecordScope, profile: SalesProfile, request: ReplyMeetingRequest): Promise<ReplyMeetingOptions> {
  const now = Date.now(), until = now + 30 * 86400_000;
  const result: ReplyMeetingOptions = {
    checkedAt: new Date(now).toISOString(), timezone: profile.timezone,
    calendarAccountKeys: [], status: "unavailable", note: "Calendar availability could not be fully verified. No times have been invented.", request, slots: [],
  };
  if (request.clarification || (request.fromDate && request.toDate && request.fromDate > request.toDate)) {
    return { ...result, status: "clarify", note: request.clarification || "Confirm the requested date range." };
  }
  try {
    const snapshot = await listConnectedCalendarAvailability(new Date(now).toISOString(), new Date(until).toISOString(), scope.userId);
    if (!snapshot?.complete || snapshot.failedCalendars.length) return result;
    const slots = chooseReplyMeetingSlots({ events: snapshot.events, timezone: profile.timezone, workdayStart: profile.workdayStart, workdayEnd: profile.workdayEnd, request, now, until });
    return { ...result, calendarAccountKeys: snapshot.accountKeys, slots, status: slots.length ? "available" : "no_slots", note: slots.length ? "Checked against your connected calendars. Earliest suitable options, with 15-minute buffers and a choice of days where possible. Not reserved. Availability is checked again before sending." : "No suitable free times were found within the next 30 days and the requested working window." };
  } catch {
    return result;
  }
}

export async function assertReplyMeetingOptionsCurrent(scope: RecordScope, options: ReplyMeetingOptions | null | undefined, body: string) {
  if (!options?.slots?.length) return;
  // Recheck named proposals. If edited/reformatted beyond recognition, check
  // every original option rather than assuming they have all been removed.
  const relevant = options.slots.filter(slot => body.includes(slot.label));
  const slots = relevant.length ? relevant : options.slots;
  if (!slots.length) return;
  const stop = () => { throw Object.assign(new Error("Your proposed meeting times could not be confirmed as free. Refresh the meeting options and review the draft before sending."), { status: 409 }); };
  if (slots.some(slot => !Number.isFinite(Date.parse(slot.start)) || Date.parse(slot.start) <= Date.now())) stop();
  try {
    const start = Math.min(...slots.map(slot => Date.parse(slot.start))) - 15 * 60_000;
    const end = Math.max(...slots.map(slot => Date.parse(slot.end))) + 15 * 60_000;
    const snapshot = await listConnectedCalendarAvailability(new Date(start).toISOString(), new Date(end).toISOString(), scope.userId);
    if (!snapshot?.complete || snapshot.failedCalendars.length || JSON.stringify(snapshot.accountKeys) !== JSON.stringify(options.calendarAccountKeys)) return stop();
    const busy = busyIntervals(snapshot.events, options.timezone);
    if (slots.some(slot => busy.some(event => Date.parse(slot.start) < event.end + 15 * 60_000 && Date.parse(slot.end) > event.start - 15 * 60_000))) stop();
  } catch { stop(); }
}
