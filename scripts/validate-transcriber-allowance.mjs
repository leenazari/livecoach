import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");
const {
  calculateTranscriberUsage,
  londonDayBounds,
  normaliseDailyTranscriberLimit,
} = await import("../lib/transcriber-usage.ts");
const { currentRecallBotState } = await import("../lib/recall-bot-status.ts");

const summer = londonDayBounds(new Date("2026-08-21T12:00:00.000Z"));
assert.equal(summer.start.toISOString(), "2026-08-20T23:00:00.000Z");
assert.equal(summer.end.toISOString(), "2026-08-21T23:00:00.000Z");

const winter = londonDayBounds(new Date("2026-01-15T12:00:00.000Z"));
assert.equal(winter.start.toISOString(), "2026-01-15T00:00:00.000Z");
assert.equal(winter.end.toISOString(), "2026-01-16T00:00:00.000Z");

const now = new Date("2026-08-21T12:00:00.000Z");
const usage = calculateTranscriberUsage(
  [
    {
      owner_id: "owner-a",
      created_at: "2026-08-21T10:00:00.000Z",
      ended_at: "2026-08-21T11:00:00.000Z",
      status: "left",
    },
    {
      owner_id: "owner-a",
      created_at: "2026-08-21T11:30:00.000Z",
      ended_at: null,
      status: "active",
    },
    {
      owner_id: "owner-b",
      created_at: "2026-08-21T09:00:00.000Z",
      ended_at: "2026-08-21T12:00:00.000Z",
      status: "left",
    },
  ],
  "owner-a",
  360,
  now
);
assert.equal(usage.usedMinutes, 90);
assert.equal(usage.remainingMinutes, 270);
assert.equal(usage.activeBot, true);
assert.equal(usage.botCount, 2);

const staleUsage = calculateTranscriberUsage(
  [
    {
      owner_id: "owner-a",
      created_at: "2026-08-21T08:00:00.000Z",
      ended_at: null,
      status: "active",
    },
  ],
  "owner-a",
  360,
  now
);
assert.equal(staleUsage.usedMinutes, 180);
assert.equal(staleUsage.activeBot, false);
assert.equal(normaliseDailyTranscriberLimit(10), 30);
assert.equal(normaliseDailyTranscriberLimit(900), 720);
assert.equal(normaliseDailyTranscriberLimit("bad"), 360);

assert.deepEqual(
  currentRecallBotState({
    status_changes: [
      { code: "joining_call", created_at: "2026-08-21T10:00:00.000Z" },
      { code: "bot.call_ended", created_at: "2026-08-21T11:00:00.000Z" },
    ],
  }),
  {
    code: "call_ended",
    terminal: true,
    endedAt: "2026-08-21T11:00:00.000Z",
  }
);
assert.equal(
  currentRecallBotState({
    status_changes: [
      { code: "in_call_recording", created_at: "2026-08-21T11:00:00.000Z" },
    ],
  }).terminal,
  false
);

const migration = read(
  "supabase/migrations/20260821183209_transcriber_cost_controls.sql"
);
const startRoute = read("app/api/meet/start/route.ts");
const teamRoute = read("app/api/crm/team/route.ts");
const teamPage = read("app/settings/team/page.tsx");

assert.match(migration, /transcriber_daily_minutes_limit/i);
assert.match(migration, /meet_bots_one_active_per_owner_uidx/i);
assert.match(migration, /created_at \+ interval '3 hours'/i);
assert.match(startRoute, /transcriber_daily_limit_reached/);
assert.match(startRoute, /transcriber_already_active/);
assert.match(startRoute, /botHardLimitSeconds/);
assert.match(startRoute, /reconcileRecallBotState/);
assert.match(startRoute, /currentRecallBotState/);
assert.match(teamRoute, /update_transcriber_limit/);
assert.match(teamRoute, /access_audit_events/);
assert.match(teamPage, /Notetaker today/);
assert.match(teamPage, /Resets at midnight UK time/);

console.log("Per-user transcriber allowance validation passed");
