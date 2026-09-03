import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldShowUnrecordedScheduledCall } from "../lib/call-list-recovery.ts";

const nowMs = Date.parse("2026-09-03T15:30:00.000Z");
const graceMs = 3 * 60 * 60 * 1000;

assert.equal(
  shouldShowUnrecordedScheduledCall({
    scheduledAt: "2026-09-03T15:00:00.000Z",
    completedAt: null,
    nowMs,
    graceMs,
    startedWithoutCapture: true,
  }),
  true,
  "a started call with no captured speech must appear immediately for manual recap"
);
assert.equal(
  shouldShowUnrecordedScheduledCall({
    scheduledAt: "2026-09-03T16:00:00.000Z",
    completedAt: null,
    nowMs,
    graceMs,
    startedWithoutCapture: true,
  }),
  false,
  "a future call must not appear in call history"
);
assert.equal(
  shouldShowUnrecordedScheduledCall({
    scheduledAt: "2026-09-03T15:00:00.000Z",
    completedAt: null,
    nowMs,
    graceMs,
    startedWithoutCapture: false,
  }),
  false,
  "an ordinary just-started calendar slot keeps the existing grace window"
);

const callsRoute = readFileSync("app/api/crm/calls/route.ts", "utf8");
assert.match(callsRoute, /startedWithoutCapture/);
assert.match(callsRoute, /shouldShowUnrecordedScheduledCall/);
assert.doesNotMatch(
  callsRoute,
  /for \(const s of sessions \|\| \[\]\)\s*if \(\(s as any\)\.upcoming_id\) coveredUpcoming\.add/,
  "an empty session shell must not hide its scheduled call"
);

console.log("Empty call recovery validation passed");
