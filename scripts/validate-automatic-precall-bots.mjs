import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { scheduledCallSessionId } from "../lib/scheduled-call-session.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const cron = read("app/api/cron/auto-join-meetings/route.ts");
const calendar = read("app/api/crm/calendar-sync/route.ts");
const start = read("app/api/meet/start/route.ts");
const call = read("app/call/page.tsx");
const vercel = JSON.parse(read("vercel.json"));

const id = "15e31b03-e720-4b4f-81f3-06842c181ae8";
assert.equal(
  scheduledCallSessionId(id),
  "lc-scheduled-15e31b03-e720-4b4f-81f3-06842c181ae8"
);
assert.equal(scheduledCallSessionId("not-a-call"), null);

// The worker is authenticated, runs once per minute and selects every active
// account through the established exact service-scope boundary.
assert.match(cron, /authorization.*Bearer \$\{secret\}/s);
assert.match(cron, /listActiveAccountScopes\(\)/);
assert.match(cron, /runWithServiceRecordScope\(account/);
assert.ok(
  vercel.crons.some(
    (entry) =>
      entry.path === "/api/cron/auto-join-meetings" &&
      entry.schedule === "* * * * *"
  )
);

// Late calendar edits are refreshed through the canonical sync. Complete
// bounded snapshots reconcile last-minute cancellations, while failed refreshes
// defer provider-owned calls rather than joining from stale data.
assert.match(cron, /calendar-sync\?mode=near-term/);
assert.match(calendar, /mode === "near-term"/);
assert.match(calendar, /if \(snapshot\.complete\)/);
assert.match(cron, /const calendarFresh/);
assert.match(cron, /const staleCalendarDeferred/);
assert.match(cron, /return !calendarOwned \|\| calendarFresh/);

// Dispatch is exact-account, exact-call and idempotent. The canonical session
// and bot endpoints remain the only writers.
assert.match(cron, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(cron, /\.eq\("owner_id", scope\.userId\)/);
assert.match(cron, /\.is\("completed_at", null\)/);
assert.match(cron, /validMeetingUrl\(call\.meeting_url\)/);
assert.match(cron, /\.eq\("upcoming_id", call\.id\)/);
assert.match(cron, /persistSession\(/);
assert.match(cron, /startBot\(/);
assert.match(cron, /autoStart: true/);
assert.match(cron, /transcriber_already_active/);

// Browser and scheduler converge on the same room. Automatic dispatch gets a
// fifteen-minute pre-activity window while manual calls retain their existing
// five-minute no-show behavior and all calls retain five-minute silence leave.
assert.match(call, /scheduledCallSessionId\(upcoming\)/);
assert.match(start, /automaticDispatch = autoStart === true/);
assert.match(start, /preActivityTimeoutSeconds = automaticDispatch \? 900 : 300/);
assert.match(start, /automaticDispatch && googleMeet[\s\S]*?\? 600/);
assert.match(start, /activate_after: automaticDispatch \? 600 : 60/);
assert.match(start, /timeout: 300/);
assert.match(start, /reattaches a scheduled room whose earlier bot ended/);
assert.match(start, /captureId: insertedCapture\.id/);

console.log("Automatic five-minute pre-call bot dispatch validation passed");
