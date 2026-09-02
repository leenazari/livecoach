import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  calendarRecurrence,
  calendarDurationMinutes,
  googleCalendarRecurrenceRule,
  googleEventIdForRequest,
  microsoftCalendarRecurrence,
  microsoftLondonDateTime,
  microsoftUtcDateTime,
  parseCalendarAttendees,
  validCalendarRequestId,
} from "../lib/calendar-create.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const requestId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
assert.equal(validCalendarRequestId(requestId), true);
assert.equal(validCalendarRequestId("not-a-request-id"), false);
assert.equal(
  googleEventIdForRequest(requestId),
  "lcf47ac10b58cc4372a5670e02b2c3d479"
);
assert.match(googleEventIdForRequest(requestId), /^[a-v0-9]+$/);

assert.deepEqual(
  parseCalendarAttendees("A@Example.com, a@example.com; b@example.com"),
  { emails: ["a@example.com", "b@example.com"], invalid: [] }
);
assert.deepEqual(parseCalendarAttendees("valid@example.com wrong-address"), {
  emails: ["valid@example.com"],
  invalid: ["wrong-address"],
});
assert.equal(calendarDurationMinutes(45), 45);
assert.equal(calendarDurationMinutes(999), 30);
assert.equal(microsoftUtcDateTime("2026-08-28T09:15:00.000Z"), "2026-08-28T09:15:00");
assert.equal(
  microsoftLondonDateTime("2026-08-28T09:15:00.000Z"),
  "2026-08-28T10:15:00"
);
const recurrence = calendarRecurrence(
  {
    frequency: "weekly",
    interval: 1,
    count: 6,
    weekdays: ["monday", "wednesday"],
  },
  "2026-08-31T09:00:00.000Z"
);
assert.deepEqual(recurrence, {
  frequency: "weekly",
  interval: 1,
  count: 6,
  weekdays: ["monday", "wednesday"],
});
assert.equal(
  googleCalendarRecurrenceRule(recurrence, "2026-08-31T09:00:00.000Z"),
  "RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=6;BYDAY=MO,WE"
);
assert.deepEqual(
  microsoftCalendarRecurrence(recurrence, "2026-08-31T09:00:00.000Z"),
  {
    pattern: {
      type: "weekly",
      interval: 1,
      daysOfWeek: ["monday", "wednesday"],
      firstDayOfWeek: "monday",
    },
    range: {
      type: "numbered",
      startDate: "2026-08-31",
      numberOfOccurrences: 6,
      recurrenceTimeZone: "GMT Standard Time",
    },
  }
);
assert.throws(
  () => calendarRecurrence({ frequency: "weekly", count: 53 }, "2026-08-31T09:00:00Z"),
  /2 and 52/
);

const [google, microsoft, provider, route, component, supabase] = await Promise.all([
  read("lib/google.ts"),
  read("lib/microsoft.ts"),
  read("lib/calendar-provider.ts"),
  read("app/api/crm/upcoming/route.ts"),
  read("components/crm/UpcomingCalls.tsx"),
  read("lib/supabase.ts"),
]);

assert.match(google, /method: "POST"/);
assert.match(google, /calendars\/primary\/events/);
assert.match(google, /query\.set\("sendUpdates", "all"\)/);
assert.match(google, /id: eventId/);
assert.match(google, /response\.status === 409/);
assert.match(google, /livecoachRequestId/);
assert.match(google, /googleCalendarRecurrenceRule/);
assert.match(google, /originalStartTime/);

assert.match(microsoft, /"\/me\/calendar\/events"/);
assert.match(microsoft, /transactionId: input\.requestId/);
assert.match(microsoft, /microsoftCalendarRecurrence/);
assert.match(microsoft, /GMT Standard Time/);
assert.match(microsoft, /"Calendars\.ReadWrite"/);
assert.match(microsoft, /getMicrosoftAccessToken\(true, ownerId\)/);

assert.match(provider, /connectedCalendarProvider\(ownerId\)/);
assert.match(provider, /getAccessToken\(false, ownerId\)/);
assert.match(provider, /createMicrosoftCalendarEvent\(input, ownerId\)/);
assert.match(provider, /externalId: `microsoft:/);
assert.match(provider, /Cross-account|Connect Google or Microsoft Calendar/);

assert.match(route, /resolveRecordScope\(\)/);
assert.match(route, /privateRecordFields\(scope\)/);
assert.match(route, /\.from\("companies"\)/);
assert.match(route, /createConnectedCalendarEvent/);
assert.match(route, /calendarRecurrence\(body\.recurrence/);
assert.match(route, /source: calendarEvent\?\.provider \|\| "manual"/);
assert.match(route, /external_id: calendarEvent\?\.externalId \|\| null/);
assert.match(route, /attendees: calendarEvent\?\.attendees/);
assert.match(route, /\.eq\("owner_id", scope\.userId\)/);
assert.match(route, /Press Sync to recover it/);

assert.match(component, /useState\(true\)/);
assert.match(component, /const \[requestId, setRequestId\]/);
assert.match(component, /Guest emails, separated by commas/);
assert.match(component, /CALENDAR_DURATION_OPTIONS\.map/);
assert.match(component, /Calendar \+ LiveCoach/);
assert.match(component, /LiveCoach only/);
assert.match(component, /The call intent stays private in LiveCoach/);
assert.match(component, /saving \|\|/);

assert.match(supabase, /fresh user-scoped client for every operation/);
assert.match(supabase, /Supabase RLS is the final authority/);

console.log("CRM calendar event creation validation passed");
