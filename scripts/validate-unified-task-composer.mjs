import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  followUpAtFromLocalParts,
  normaliseFollowUpAt,
} from "../lib/follow-up-scheduling.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const localDueAt = followUpAtFromLocalParts("2027-02-18", "14:25");
assert.ok(localDueAt);
assert.equal(new Date(localDueAt).getHours(), 14);
assert.equal(new Date(localDueAt).getMinutes(), 25);
assert.equal(normaliseFollowUpAt(localDueAt), localDueAt);

const composer = read("components/crm/TaskComposer.tsx");
const picker = read("components/crm/CompanyLinkPicker.tsx");
const taskList = read("components/crm/TaskList.tsx");
const taskRoute = read("app/api/crm/tasks/route.ts");
const tasks = read("lib/tasks.ts");
const today = read("app/crm/page.tsx");
const board = read("app/crm/board/page.tsx");
const client = read("app/crm/[id]/page.tsx");
const opportunities = read("components/crm/OpportunityBoard.tsx");
const outreach = read("app/crm/outreach/page.tsx");
const inbox = read("app/crm/inbox/page.tsx");
const calls = read("app/crm/calls/page.tsx");
const upcoming = read("app/api/crm/upcoming/route.ts");

assert.match(composer, /What needs to be done/);
assert.match(composer, /Task type/);
assert.match(composer, /General task/);
assert.match(composer, /Call or follow-up/);
assert.match(composer, /Email/);
assert.match(composer, /Client and prospect context/);
assert.match(composer, /Client context, optional/);
assert.match(composer, /type="date"/);
assert.match(composer, /type="time"/);
assert.match(composer, /Keep at the top as a priority/);
assert.match(composer, /followUpAtFromLocalParts/);
assert.match(composer, /crypto\.randomUUID\(\)/);
assert.match(composer, /lc:tasks-updated/);
assert.match(composer, /lc:crm-updated/);
assert.match(composer, /allowCreate=\{false\}/);
assert.match(picker, /allowCreate = true/);

assert.match(taskList, /import TaskComposer/);
assert.ok(
  taskList.indexOf("const taskComposer") < taskList.indexOf("if (shown.length === 0)"),
  "The task form must remain available when a task list is empty"
);
assert.match(today, /<TaskList[\s\S]*?showCompany[\s\S]*?allowBulk/);
assert.match(board, /<TaskList showCompany allowBulk/);
assert.match(client, /<TaskList[\s\S]*?companyId=\{id\}[\s\S]*?companyName=\{company\.name\}/);
assert.match(opportunities, /<TaskList[\s\S]*?companyId=\{o\.companyId\}[\s\S]*?companyName=\{o\.company\}/);
assert.match(inbox, /import TaskComposer/);
assert.match(inbox, /<TaskComposer \/>/);
assert.match(calls, /import TaskComposer/);
assert.match(calls, /<TaskComposer \/>/);
assert.match(outreach, /✓ Log a task/);
assert.match(outreach, /taskProspectId === prospect\.id/);
assert.match(outreach, /prospect=\{\{/);

assert.match(taskRoute, /requireRequestScope\(\)/);
assert.match(taskRoute, /MANUAL_ACTIONS/);
assert.match(taskRoute, /normaliseFollowUpAt/);
assert.match(taskRoute, /followUpAtIsPast/);
assert.match(taskRoute, /Call and follow-up tasks need a due date and time/);
assert.match(taskRoute, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(taskRoute, /\.eq\("assigned_to_user_id", scope\.userId\)/);
assert.match(taskRoute, /loadAssignedClientAccess/);
assert.match(taskRoute, /source: manualRequest \? "manual_task"/);
assert.match(taskRoute, /fingerprintKey: sourceRef/);
assert.match(taskRoute, /\.eq\("source_ref", sourceRef\)/);
assert.match(tasks, /\.\.\.privateRecordFields\(accountScope\)/);
assert.match(upcoming, /\.eq\("owner_id", scope\.userId\)/);
assert.match(upcoming, /\.eq\("link_kind", "call"\)/);

console.log("Unified task composer checks passed");
