import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const lane = read("components/crm/OutreachTodayLane.tsx");
const page = read("app/crm/inbox/page.tsx");
const queue = read("app/api/crm/outreach/queue/route.ts");
const nextAction = read("app/api/crm/outreach/[id]/next-action/route.ts");
const inbox = read("app/api/crm/inbox/route.ts");
const tasks = read("lib/tasks.ts");
const taskRoute = read("app/api/crm/tasks/route.ts");

// Exact visible copy goes through the established approval endpoint before the
// existing send queue. There is no bulk approval or direct mailbox send.
assert.match(lane, /`\/api\/crm\/outreach\/messages\/\$\{message\.id\}`/);
assert.match(lane, /subject: edit\.subject[\s\S]*body_text: edit\.body/);
assert.match(lane, /status: "approved"/);
assert.match(
  lane,
  /crmFetch<\{ message: OutreachMessage \}>[\s\S]*crmFetch\(`\/api\/crm\/outreach\/messages\/\$\{message\.id\}\/send`/
);
assert.match(lane, /Approval covers the exact words above/);
assert.doesNotMatch(lane, /gmail\.users\.messages\.send|supabaseAdmin/);

// Research and history are bounded projections of saved records. Opening them
// does not invoke research or another model request.
assert.match(queue, /compactSavedResearch/);
assert.match(queue, /\.slice\(0, 5\)[\s\S]*\.map\(compactMessage\)/);
assert.match(queue, /researchSourceCount/);
assert.match(lane, /Saved research/);
assert.match(lane, /Contact history/);
assert.doesNotMatch(lane, /research_sources|https?:\/\//);

// Positive replies become one scoped, dated task. They never create a client
// or opportunity implicitly, and the exact reply receipt hides only once that
// canonical task is confirmed.
assert.match(page, /replyItems=\{\(data\?\.items \|\| \[\]\)\.filter/);
assert.match(nextAction, /requireRequestScope\(\)/);
assert.match(nextAction, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(nextAction, /\.eq\("assigned_to_user_id", account\.userId\)/);
assert.match(nextAction, /reply_category !== "interested"/);
assert.match(nextAction, /sourceRef = `outreach-reply:/);
assert.match(nextAction, /await upsertTasks\(companyId/);
assert.doesNotMatch(nextAction, /from\("companies"\)\s*\.insert/);
assert.doesNotMatch(nextAction, /from\("opportunities"\)\s*\.insert/);
assert.match(inbox, /source_ref/);
assert.match(inbox, /handledReplyRefs/);
assert.match(tasks, /\.eq\("workspace_id", accountScope\.workspaceId\)[\s\S]*\.eq\("owner_id", accountScope\.userId\)/);
assert.match(taskRoute, /const account = await resolveRecordScope\(\)/);
assert.match(taskRoute, /from\("tasks"\)[\s\S]*\.eq\("workspace_id", account\.workspaceId\)[\s\S]*\.eq\("owner_id", account\.userId\)/);
assert.match(taskRoute, /from\("upcoming_calls"\)[\s\S]*\.eq\("workspace_id", account\.workspaceId\)[\s\S]*\.eq\("owner_id", account\.userId\)/);
assert.doesNotMatch(taskRoute, /from\("companies"\)\.select\("id, name"\)\s*[,)]/);

console.log("Sales Today inline workflow checks passed");
