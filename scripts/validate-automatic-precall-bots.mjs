import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { scheduledCallSessionId } from "../lib/scheduled-call-session.ts";
import { precallJoinAt, precallScheduleAction } from "../lib/precall-schedule.ts";
import { currentRecallBotState } from "../lib/recall-bot-status.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const calendar = read("app/api/crm/calendar-sync/route.ts");
const scheduler = read("lib/automatic-precall.ts");
const cancellation = read("lib/recall-scheduled-bot.ts");
const start = read("app/api/meet/start/route.ts");
const usage = read("lib/transcriber-usage.ts");
const migration = read(
  "supabase/migrations/20261004170018_schedule_pre_call_notetakers.sql"
);
const call = read("app/call/page.tsx");
const vercel = JSON.parse(read("vercel.json"));

const id = "15e31b03-e720-4b4f-81f3-06842c181ae8";
assert.equal(
  scheduledCallSessionId(id),
  "lc-scheduled-15e31b03-e720-4b4f-81f3-06842c181ae8"
);
assert.equal(scheduledCallSessionId("not-a-call"), null);

const nowMs = Date.parse("2026-10-04T09:00:00Z");
assert.equal(precallJoinAt("2026-10-05T09:00:00Z", nowMs), "2026-10-05T08:55:00.000Z");
// BST -> GMT uses the event's offset, never a server-local date.
assert.equal(precallJoinAt("2026-10-25T10:00:00+00:00", nowMs), "2026-10-25T09:55:00.000Z");
assert.equal(precallJoinAt("2026-10-04T09:04:00Z", nowMs), null);
assert.equal(precallJoinAt("bad-date", nowMs), null);
for (const input of [
  { scheduledAt: "2026-10-05T09:00:00Z", completed: false, supportedLink: true, expected: "schedule" },
  { scheduledAt: "2026-10-04T08:30:00Z", completed: false, supportedLink: true, expected: "skip" },
  { scheduledAt: "2026-11-04T08:30:00Z", completed: false, supportedLink: true, expected: "skip" },
  { scheduledAt: "2026-10-05T09:00:00Z", completed: true, supportedLink: true, expected: "cancel" },
  { scheduledAt: "2026-10-05T09:00:00Z", completed: false, supportedLink: false, expected: "cancel" },
  { scheduledAt: "invalid", completed: false, supportedLink: true, expected: "cancel" },
]) assert.equal(precallScheduleAction({ ...input, nowMs }), input.expected);
const reservationState = currentRecallBotState({ join_at: new Date(Date.now() + 3600000).toISOString(), status_changes: [] });
assert.equal(reservationState.phase, "scheduled");
assert.equal(reservationState.terminal, false);
assert.equal(reservationState.recording, false);

// There is no workspace-wide minute poll. Calendar sync creates or reconciles
// one provider-side reservation whenever the canonical event is saved.
assert.ok(
  !vercel.crons.some(
    (entry) => entry.path === "/api/cron/auto-join-meetings"
  )
);
assert.match(calendar, /scheduleAutomaticNotetakersForUpcomingIds/);
assert.match(calendar, /syncedUpcomingIds/);
assert.match(scheduler, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(scheduler, /\.eq\("owner_id", scope\.userId\)/);
assert.match(scheduler, /validMeetingUrl\(call\.meeting_url\)/);
assert.match(scheduler, /ignoreDuplicates: true/);
assert.match(scheduler, /startBot\(/);
assert.match(scheduler, /autoStart: true/);

// The exact five-minute join is reserved with Recall. A repeated sync reuses
// the reservation, while time/link changes and cancellations remove the old
// provider bot before replacing or deleting its source event.
assert.match(start, /precallJoinAt\(verifiedScheduledAt, now\.getTime\(\)\)/);
assert.match(start, /automaticDispatch && !upcomingId/);
assert.match(start, /code: "calendar_call_changed"/);
assert.match(start, /join_at: scheduledJoinAt/);
assert.match(start, /source_upcoming_id/);
assert.match(start, /exactReservation/);
assert.match(start, /cancelScheduledNotetakers/);
assert.match(start, /reservedSubscriptions[\s\S]*?\.eq\("owner_id", accountScope\.userId\)[\s\S]*?\.eq\("upcoming_id", verifiedUpcomingId\)/);
assert.match(calendar, /staleIds\.length[\s\S]*?cancelScheduledNotetakers[\s\S]*?\.delete\(\)/);
assert.match(cancellation, /method: "DELETE"/);
assert.match(cancellation, /leave_call/);
assert.match(cancellation, /\.from\("meet_capture_subscribers"\)[\s\S]*?\.eq\("owner_id", input\.ownerId\)[\s\S]*?\.in\("upcoming_id", upcomingIds\)/);
assert.match(cancellation, /if \(\(count \|\| 0\) <= selectedCount\) capturesToCancel\.push/);
assert.match(cancellation, /for \(const capture of capturesToCancel\)[\s\S]*?cancelRecallBotRequest[\s\S]*?const endedAt/);
assert.match(cancellation, /\.gt\("scheduled_join_at", nowIso\)/);

// Future reservations do not consume the one-live-call slot or usage before
// their join time. Browser and scheduler still converge on one private room.
assert.match(migration, /scheduled_join_at timestamptz/);
assert.match(migration, /status in \('scheduled', 'active', 'ended'\)/);
assert.match(migration, /meet_bots_one_scheduled_upcoming_uidx/);
assert.match(usage, /row\.scheduled_join_at \|\| row\.created_at/);
assert.match(call, /scheduledCallSessionId\(upcoming\)/);

// Provider-side abandoned-call protection remains in force after the bot's
// scheduled five-minute arrival.
assert.match(start, /preActivityTimeoutSeconds = automaticDispatch \? 900 : 300/);
assert.match(start, /waiting_room_timeout: Math.min\(\s*preActivityTimeoutSeconds/);
assert.match(start, /activate_after: automaticDispatch \? 600 : 60/);
assert.match(start, /timeout: 300/);

console.log("Event-scheduled five-minute pre-call bot validation passed");
