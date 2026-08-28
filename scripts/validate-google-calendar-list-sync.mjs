import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const google = read("lib/google.ts");
const provider = read("lib/calendar-provider.ts");
const syncRoute = read("app/api/crm/calendar-sync/route.ts");
const googleStatus = read("app/api/auth/google/status/route.ts");
const settings = read("app/settings/page.tsx");
const initialSync = read("components/InitialCalendarSync.tsx");
const upcoming = read("components/crm/UpcomingCalls.tsx");

assert.match(
  google,
  /GOOGLE_CALENDAR_LIST_READ_SCOPE\s*=\s*\n?\s*"https:\/\/www\.googleapis\.com\/auth\/calendar\.calendarlist\.readonly"/
);
assert.match(
  google,
  /const SCOPE = \[[\s\S]*GOOGLE_CALENDAR_EVENTS_SCOPE,[\s\S]*GOOGLE_CALENDAR_LIST_READ_SCOPE,/
);
assert.match(google, /export function googleCanListCalendars/);
assert.match(google, /calendarListAccessible: boolean \| null/);
assert.match(google, /calendarListAccessible = error\?\.status === 403 \? false : null/);
assert.match(google, /complete = false/);
assert.match(google, /failedCalendars\.push/);
assert.match(
  google,
  /return \{ events: out, complete, failedCalendars, calendarListAccessible \}/
);

assert.match(provider, /\.\.\.snapshot/);
assert.doesNotMatch(provider, /\.\.\.snapshot,[\s\S]{0,80}failedCalendars: \[\]/);

assert.match(syncRoute, /snapshot\.complete/);
assert.match(syncRoute, /snapshot\.calendarListAccessible === false/);
assert.match(syncRoute, /calendarReconnectRequired/);
assert.match(syncRoute, /Reconnect Google once to include secondary and shared calendars/);

assert.match(googleStatus, /googleCanListCalendars\(scopes\)/);
assert.match(googleStatus, /calendarReconnectRequired/);
assert.match(settings, /Grant calendar access/);
assert.match(settings, /Google partly connected/);
assert.match(initialSync, /status: result\.calendarReconnectRequired \? "warning" : "success"/);
assert.match(upcoming, /reconnect Google once in Settings to include all calendars/);

console.log("Google multi-calendar permission and safe partial-sync checks passed");
