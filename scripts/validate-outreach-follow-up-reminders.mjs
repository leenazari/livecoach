import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  followUpAtFromLocalParts,
  followUpAtIsPast,
  normaliseFollowUpAt,
} from "../lib/follow-up-scheduling.ts";

const read = (file) => readFileSync(file, "utf8");

const localIso = followUpAtFromLocalParts("2026-09-04", "14:30");
assert.ok(localIso);
assert.equal(new Date(localIso).getHours(), 14);
assert.equal(new Date(localIso).getMinutes(), 30);
assert.equal(
  normaliseFollowUpAt("2026-09-04T13:30:00.000Z"),
  "2026-09-04T13:30:00.000Z"
);
assert.equal(normaliseFollowUpAt("2026-09-04T14:30"), null);
assert.equal(
  followUpAtIsPast(
    "2026-09-04T13:30:00.000Z",
    new Date("2026-09-04T13:29:00.000Z")
  ),
  false
);

const page = read("app/crm/outreach/page.tsx");
const component = read("components/crm/ProspectFollowUpReminder.tsx");
const callComponent = read("components/crm/ProspectManualCall.tsx");
const route = read("app/api/crm/outreach/[id]/follow-up/route.ts");
const callRoute = read("app/api/crm/outreach/[id]/manual-call/route.ts");
const helper = read("lib/outreach-follow-up.ts");
const tasks = read("lib/tasks.ts");
const taskList = read("components/crm/TaskList.tsx");
const taskRoute = read("app/api/crm/tasks/[id]/route.ts");
const upcoming = read("components/crm/UpcomingCalls.tsx");
const inbox = read("app/api/crm/inbox/route.ts");

assert.match(page, /◷ Log follow-up reminder/);
assert.match(page, /ProspectFollowUpReminder/);
assert.match(component, /type="date"/);
assert.match(component, /type="time"/);
assert.match(component, /followUpAtFromLocalParts/);
assert.match(component, /lc:tasks-updated/);
assert.match(component, /Today, To-dos and Calls/);

assert.match(route, /requireRequestScope\(\)/);
assert.match(route, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(route, /\.eq\("assigned_to_user_id", scope\.userId\)/);
assert.match(route, /normaliseFollowUpAt/);
assert.match(route, /followUpAtIsPast/);
assert.match(route, /saveOutreachFollowUpTask/);

assert.match(helper, /\.eq\("workspace_id", args\.scope\.workspaceId\)/);
assert.match(helper, /\.eq\("owner_id", args\.scope\.userId\)/);
assert.match(helper, /\.contains\("payload", \{ outreachProspectId: args\.prospect\.id \}\)/);
assert.match(helper, /link_kind: "call"/);
assert.match(helper, /scheduledTime: true/);
assert.match(helper, /fingerprintKey: sourceRef/);
assert.match(tasks, /fingerprintKey\?: string \| null/);
assert.match(taskRoute, /if \(!current\.payload\?\.lastRequestId\)/);

assert.match(callComponent, /Follow-up date/);
assert.match(callComponent, /Follow-up time/);
assert.match(callComponent, /followUpAt,/);
assert.match(callComponent, /lc:tasks-updated/);
assert.match(callRoute, /Choose the follow-up date and time before saving this call/);
assert.match(callRoute, /manualCallReminderText/);
assert.match(callRoute, /source: "outreach_manual_call"/);
assert.match(callRoute, /reminderTaskId:/);
assert.ok(
  callRoute.indexOf("saveOutreachFollowUpTask") < callRoute.indexOf("waitUntil("),
  "The canonical reminder must save before background call interpretation"
);

assert.match(taskList, /t\.payload\?\.scheduledTime === true/);
assert.match(upcoming, /hour: "2-digit"/);
assert.match(upcoming, /minute: "2-digit"/);
assert.match(inbox, /!latestManualCall\.reminderTaskId/);

console.log("Outreach follow-up reminder checks passed");
