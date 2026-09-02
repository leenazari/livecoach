import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const component = read("components/crm/UpcomingCalls.tsx");
const home = read("app/crm/page.tsx");
const callsPage = read("app/crm/calls/page.tsx");
const upcomingRoute = read("app/api/crm/upcoming/route.ts");
const dashboardRoute = read("app/api/crm/dashboard/route.ts");

assert.match(component, /daysAhead\?: number/);
assert.match(component, /\/api\/crm\/upcoming\?days=/);
assert.match(home, /<UpcomingCalls[^>]*daysAhead=\{7\}/);
assert.match(callsPage, /<UpcomingCalls limit=\{10\} \/>/);
assert.match(upcomingRoute, /requestedDays >= 1/);
assert.match(upcomingRoute, /requestedDays <= 31/);
assert.match(upcomingRoute, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(upcomingRoute, /\.eq\("owner_id", scope\.userId\)/);
assert.match(upcomingRoute, /\.gte\("scheduled_at", nowIso\)/);
assert.match(upcomingRoute, /\.lte\("scheduled_at", horizonIso\)/);
assert.match(dashboardRoute, /dashboardNow \+ 7 \* 24 \* 60 \* 60 \* 1000/);
assert.match(dashboardRoute, /\.lte\("scheduled_at", sevenDayHorizon\)/);

console.log("Dashboard seven-day call-window checks passed");
