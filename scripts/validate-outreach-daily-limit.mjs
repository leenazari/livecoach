import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTREACH_DAILY_HARD_LIMIT,
  OUTREACH_DEFAULT_DAILY_LIMIT,
  clampOutreachDailyLimit,
} from "../lib/outreach-limits.ts";
import { OVERNIGHT_RESEARCH_INVENTORY_LIMIT } from "../lib/outreach-overnight-preparation.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.equal(OUTREACH_DAILY_HARD_LIMIT, 50);
assert.equal(OUTREACH_DEFAULT_DAILY_LIMIT, 50);
assert.equal(clampOutreachDailyLimit(undefined), 50);
assert.equal(clampOutreachDailyLimit(20), 20);
assert.equal(clampOutreachDailyLimit(50), 50);
assert.equal(clampOutreachDailyLimit(51), 50);
assert.equal(clampOutreachDailyLimit(-4), 1);

// The user's explicit cost control is separate from the manual queue and send
// ceiling. Overnight work must continue to stop at 20 researched leads per
// salesperson even though a manually chosen campaign can now run to 50.
assert.equal(OVERNIGHT_RESEARCH_INVENTORY_LIMIT, 20);

const migration = read(
  "supabase/migrations/20260901095601_raise_outreach_daily_limit_to_50.sql"
);
assert.match(migration, /daily_limit between 1 and 50/);
assert.match(migration, /daily_limit set default 50/);

const outreachPage = read("app/crm/outreach/page.tsx");
const todayLane = read("components/crm/OutreachTodayLane.tsx");
const readiness = read("app/api/crm/outreach/readiness/route.ts");
const queueRoute = read("app/api/crm/outreach/queue/route.ts");
assert.match(outreachPage, /max=\{OUTREACH_DAILY_HARD_LIMIT\}/);
assert.match(outreachPage, /maximum \{OUTREACH_DAILY_HARD_LIMIT\}\/day/);
assert.match(todayLane, /DAILY_QUEUE_TARGET = OUTREACH_DAILY_HARD_LIMIT/);
assert.match(readiness, /hard ceiling is \$\{OUTREACH_DAILY_HARD_LIMIT\}/);
assert.match(queueRoute, /const campaignDailyLimit = clampOutreachDailyLimit/);
assert.match(queueRoute, /Math\.min\(campaignDailyLimit, requestedDailyLimit\)/);

console.log("Outreach daily limit checks passed");
