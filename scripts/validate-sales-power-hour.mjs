import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpportunityInboxItem } from "../lib/work-inbox.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const nowMs = Date.parse("2026-08-22T10:00:00Z");
const endTodayMs = Date.parse("2026-08-22T22:59:59Z");

const overdue = buildOpportunityInboxItem({
  opportunity: {
    id: "11111111-1111-4111-8111-111111111111",
    company_id: "22222222-2222-4222-8222-222222222222",
    title: "Expansion",
    value: 40_000,
    pipeline_stage: "proposal",
    win_outlook: "likely",
    next_action: "Send the final pilot terms",
    next_action_due_at: "2026-08-21T12:00:00Z",
    next_action_owner: "us",
  },
  company: "Example Client",
  nowMs,
  endTodayMs,
});
assert.equal(overdue.kind, "opportunity");
assert.equal(overdue.priority, 110);
assert.equal(overdue.priorityLabel, "urgent");
assert.equal(overdue.revenue, true);

const buyerWaiting = buildOpportunityInboxItem({
  opportunity: {
    id: "33333333-3333-4333-8333-333333333333",
    company_id: "44444444-4444-4444-8444-444444444444",
    title: "Pilot",
    pipeline_stage: "discovery",
    win_outlook: "possible",
    next_action: "Buyer confirms the pilot team",
    next_action_owner: "buyer",
  },
  company: "Buyer Ltd",
  nowMs,
  endTodayMs,
});
assert.equal(buyerWaiting.waiting, true);
assert.equal(buyerWaiting.priorityLabel, "waiting");

const missingAction = buildOpportunityInboxItem({
  opportunity: {
    id: "55555555-5555-4555-8555-555555555555",
    company_id: "66666666-6666-4666-8666-666666666666",
    title: "New opportunity",
  },
  company: "New Co",
  nowMs,
  endTodayMs,
});
assert.match(missingAction.title, /Set the next action/);
assert.ok(missingAction.priority >= 78);

const inboxApi = read("app/api/crm/inbox/route.ts");
const cleanupApi = read("app/api/crm/inbox/cleanup/route.ts");
const taskApi = read("app/api/crm/tasks/[id]/route.ts");
const followUpApi = read("app/api/crm/follow-ups/[id]/route.ts");
const opportunityApi = read("app/api/crm/opportunities/[id]/route.ts");
const inboxPage = read("app/crm/inbox/page.tsx");
const dashboardApi = read("app/api/crm/dashboard/route.ts");
const middleware = read("middleware.ts");

assert.match(inboxApi, /const account = requireRequestScope\(\)/);
assert.match(inboxApi, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(inboxApi, /\.eq\("owner_id", account\.userId\)/);
assert.match(inboxApi, /\.eq\("assigned_to_user_id", account\.userId\)/);
assert.match(inboxApi, /\.eq\("sender_user_id", account\.userId\)/);
assert.match(inboxApi, /loadSafeSharedCompanies/);
assert.match(inboxApi, /buildOpportunityInboxItem/);
assert.match(inboxApi, /canonicalOpportunityActions/);
assert.match(inboxApi, /viewer:/);

for (const route of [cleanupApi, taskApi, followUpApi]) {
  assert.match(route, /requireRequestScope\(\)/);
  assert.match(route, /\.eq\("workspace_id", account\.workspaceId\)/);
  assert.match(route, /\.eq\("owner_id", account\.userId\)/);
}
assert.match(opportunityApi, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(opportunityApi, /current\.visibility !== "team"/);

assert.match(inboxPage, /Sales Power Hour/);
assert.match(inboxPage, /One action\. Finish it\. Move on\./);
assert.match(inboxPage, /Complete and set next move/);
assert.match(inboxPage, /sales_power_hour/);
assert.match(inboxPage, /target="_blank"/);
assert.match(inboxPage, /Changes only count when the source record confirms them/);

assert.match(dashboardApi, /requestScope\.role !== "owner"/);
assert.match(middleware, /path === "\/crm" && membership\.role !== "owner"/);
assert.match(middleware, /url\.pathname = "\/crm\/inbox"/);

console.log("Sales Power Hour security and workflow checks passed");
