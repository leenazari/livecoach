import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const upcomingRoute = readFileSync("app/api/crm/upcoming/route.ts", "utf8");
const upcomingGet = upcomingRoute.slice(0, upcomingRoute.indexOf("// POST /api/crm/upcoming"));
const upcomingList = readFileSync("components/crm/UpcomingCalls.tsx", "utf8");
const callsPage = readFileSync("app/crm/calls/page.tsx", "utf8");

assert.match(upcomingRoute, /\.from\("tasks"\)/);
assert.match(
  upcomingRoute,
  /\.eq\("workspace_id", scope\.workspaceId\)[\s\S]{0,160}\.eq\("owner_id", scope\.userId\)[\s\S]{0,160}\.eq\("status", "open"\)[\s\S]{0,160}\.eq\("link_kind", "call"\)[\s\S]{0,160}\.not\("due_at", "is", null\)/
);
assert.match(upcomingRoute, /callReminders:/);
assert.match(upcomingRoute, /callRemindersResult\.error/);
assert.match(upcomingRoute, /calls_and_reminders_unavailable/);
assert.doesNotMatch(upcomingGet, /err\?\.message/);
assert.doesNotMatch(
  upcomingRoute,
  /insert[\s\S]{0,160}callReminders|callReminders[\s\S]{0,160}\.from\("upcoming_calls"\)\.insert/,
  "Call reminders must stay canonical tasks rather than being copied into calls"
);

assert.match(upcomingList, /Call reminders/);
assert.match(upcomingList, /d\.callReminders \|\| \[\]/);
assert.match(upcomingList, /\/api\/crm\/tasks\/\$\{encodeURIComponent\(id\)\}/);
assert.match(upcomingList, /JSON\.stringify\(\{ status: "done" \}\)/);
assert.match(upcomingList, /task\.status !== "done"/);
assert.match(upcomingList, /completes the same reminder everywhere in LiveCoach/);

assert.match(callsPage, /import UpcomingCalls from "@\/components\/crm\/UpcomingCalls"/);
assert.match(callsPage, /<UpcomingCalls limit=\{10\} \/>/);

console.log("Call reminder list checks passed");
