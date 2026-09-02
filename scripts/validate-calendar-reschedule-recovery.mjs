import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldReopenScheduledCalendarCall } from "../lib/calendar-sync-recovery.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const nowMs = Date.parse("2026-09-02T22:00:00.000Z");
assert.equal(
  shouldReopenScheduledCalendarCall({
    scheduledAt: "2026-09-03T12:00:00.000Z",
    completedAt: "2026-08-10T14:27:58.256Z",
    nowMs,
  }),
  true,
  "a live future event must reopen when an old completion marker remains"
);
assert.equal(
  shouldReopenScheduledCalendarCall({
    scheduledAt: "2026-09-03T12:00:00.000Z",
    completedAt: null,
    nowMs,
  }),
  false,
  "an already-open future event needs no repair"
);
assert.equal(
  shouldReopenScheduledCalendarCall({
    scheduledAt: "2026-09-02T12:00:00.000Z",
    completedAt: "2026-09-02T13:00:00.000Z",
    nowMs,
  }),
  false,
  "a genuinely completed past event must stay completed"
);

const sync = read("app/api/crm/calendar-sync/route.ts");
const context = read("lib/crm-context.ts");
const assistant = read("app/api/crm/assistant/route.ts");
const assistantUi = read("components/crm/ClientAssistant.tsx");

assert.match(sync, /shouldReopenScheduledCalendarCall/);
assert.match(sync, /\? \{ completed_at: null \}/);
assert.match(sync, /reopened,/);
assert.match(
  sync,
  /select\("id, external_id, company_id, completed_at"\)[\s\S]{0,180}\.eq\("workspace_id", scope\.workspaceId\)[\s\S]{0,100}\.eq\("owner_id", scope\.userId\)/
);
assert.match(
  sync,
  /update\(\{[\s\S]{0,700}completed_at: null[\s\S]{0,450}\.eq\("workspace_id", scope\.workspaceId\)[\s\S]{0,100}\.eq\("owner_id", scope\.userId\)/
);
assert.match(sync, /for \(const result of updateResults\)[\s\S]{0,100}if \(result\.error\) throw result\.error/);

assert.match(context, /meeting_url, completed_at/);
assert.match(context, /HIDDEN FROM CALLS LIST BY A STALE COMPLETION MARKER/);
assert.match(
  context,
  /upcomingQuery = upcomingQuery[\s\S]{0,120}\.eq\("workspace_id", requestScope\.workspaceId\)[\s\S]{0,100}\.eq\("owner_id", requestScope\.userId\)/
);
assert.match(assistant, /"restore_call"/);
assert.match(assistant, /body: \{ completed: false \}/);
assert.match(assistant, /Do not tell them to refresh because refresh cannot repair that stored state/);
assert.match(assistantUi, /action\?\.type === "restore_call"/);
assert.match(assistantUi, /result\.call\.completed_at !== null/);

console.log("Calendar reschedule recovery and Brain restore checks passed");
