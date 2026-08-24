import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync("app/api/crm/upcoming/route.ts", "utf8");
const itemApi = readFileSync("app/api/crm/upcoming/[id]/route.ts", "utf8");
const component = readFileSync("components/crm/UpcomingCalls.tsx", "utf8");

assert.match(api, /recentlyCompleted/);
assert.match(api, /\.not\("completed_at", "is", null\)/);
assert.match(api, /recoveryCutoff/);
assert.match(api, /isPrepEligibleCalendarEvent/);

assert.match(itemApi, /body\.completed === true/);
assert.match(itemApi, /Date\.now\(\) \+ 15 \* 60 \* 1000/);
assert.match(itemApi, /This meeting has not started yet/);
assert.match(itemApi, /body\.completed \? new Date\(\)\.toISOString\(\) : null/);

assert.match(component, /recover calls/);
assert.match(component, /restore to upcoming/);
assert.match(component, /JSON\.stringify\(\{ completed: false \}\)/);
assert.match(component, /canMarkDone/);

console.log("Upcoming call recovery validation passed");
