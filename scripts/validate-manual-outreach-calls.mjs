import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultManualCallNextAction,
  manualCallNextActionAt,
  nextProspectStatus,
} from "../lib/outreach-manual-call-rules.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

assert.equal(defaultManualCallNextAction("no_answer"), "Call again at a different time");
assert.equal(nextProspectStatus("imported", "meeting_booked"), "qualified");
assert.equal(nextProspectStatus("qualified", "connected"), "qualified");
assert.equal(
  manualCallNextActionAt("no_answer", null, new Date("2026-08-27T10:00:00Z")),
  "2026-08-29T12:00:00.000Z"
);

const route = read("app/api/crm/outreach/[id]/manual-call/route.ts");
const interpretation = read("lib/outreach-manual-call.ts");
const component = read("components/crm/ProspectManualCall.tsx");
const page = read("app/crm/outreach/page.tsx");
const inbox = read("app/api/crm/inbox/route.ts");
const metrics = read("app/api/crm/outreach/metrics/route.ts");
const migration = read("supabase/migrations/20260827070513_manual_outreach_call_events.sql");

assert.match(route, /requireRequestScope\(\)/);
assert.match(route, /assigned_to_user_id !== account\.userId/);
assert.match(route, /kind: "manual_call"/);
assert.match(route, /waitUntil\(/);
assert.ok(
  route.indexOf('kind: "manual_call"') < route.indexOf("waitUntil("),
  "The factual call must save before background interpretation"
);
assert.match(route, /eq\("workspace_id", account\.workspaceId\)/);
assert.match(route, /eq\("assigned_to_user_id", account\.userId\)/);
assert.match(interpretation, /kind: "manual_call_interpreted"/);
assert.match(interpretation, /The human's explicit next action always wins/);
assert.match(interpretation, /needsInterpretation/);
assert.match(interpretation, /No answer\. No conversation or buying signal was recorded/);
assert.match(interpretation, /Re-read after the model call/);
assert.match(component, /foldDictationEvent/);
assert.match(component, /Save call and next step/);
assert.match(page, /☎ Log call/);
assert.match(page, /latest_manual_call/);
assert.match(inbox, /manual-call-next:/);
assert.match(metrics, /callsToday/);
assert.match(metrics, /callMeetings/);
assert.match(migration, /outreach_manual_call_request_once_idx/);
assert.match(migration, /manual_call_interpreted/);

console.log("Manual outreach call checks passed");
