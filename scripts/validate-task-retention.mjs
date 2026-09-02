import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isStaleTask,
  TASK_RETENTION_DAYS,
} from "../lib/stale.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const DAY_MS = 24 * 60 * 60 * 1000;
const nowMs = Date.parse("2026-09-02T12:00:00.000Z");
const createdAt = (daysAgo) => new Date(nowMs - daysAgo * DAY_MS).toISOString();
const baseContext = {
  companies: [],
  lastCallMsByCompany: new Map(),
  todayYMD: "2026-09-02",
  activePriorityCompanyIds: new Set(),
  activeWorkstreamIds: new Set(),
  nowMs,
};
const task = (overrides = {}) => ({
  company_id: null,
  workstream_id: null,
  text: "Review exhibition options",
  kind: "next_step",
  link_kind: "client",
  created_at: createdAt(61),
  due_at: null,
  payload: null,
  ...overrides,
});

assert.equal(TASK_RETENTION_DAYS, 60);
assert.equal(isStaleTask(task(), baseContext).stale, true);
assert.equal(isStaleTask(task({ created_at: createdAt(59) }), baseContext).stale, false);
assert.equal(isStaleTask(task({ created_at: createdAt(60) }), baseContext).stale, true);
assert.equal(
  isStaleTask(
    task({ payload: { retentionTouchedAt: createdAt(5) } }),
    baseContext
  ).stale,
  false
);
assert.equal(isStaleTask(task({ payload: { pinned: true } }), baseContext).stale, false);
assert.equal(
  isStaleTask(task({ payload: { retentionProtected: true } }), baseContext).stale,
  false
);
assert.equal(isStaleTask(task({ payload: { urgency: "high" } }), baseContext).stale, false);
assert.equal(isStaleTask(task({ payload: { urgency: "urgent" } }), baseContext).stale, false);
assert.equal(
  isStaleTask(task({ due_at: "2026-06-01T09:00:00.000Z" }), baseContext).stale,
  false
);
assert.equal(
  isStaleTask(
    task({ company_id: "priority-company" }),
    {
      ...baseContext,
      activePriorityCompanyIds: new Set(["priority-company"]),
    }
  ).stale,
  false
);
assert.equal(
  isStaleTask(
    task({ workstream_id: "active-workstream" }),
    {
      ...baseContext,
      activeWorkstreamIds: new Set(["active-workstream"]),
    }
  ).stale,
  false
);

// A task tied to a moment that has definitely passed still clears even when the
// wider client remains an active priority.
assert.equal(
  isStaleTask(
    task({ company_id: "priority-company", text: "Prepare for the client call" }),
    {
      ...baseContext,
      activePriorityCompanyIds: new Set(["priority-company"]),
      lastCallMsByCompany: new Map([["priority-company", nowMs - DAY_MS]]),
    }
  ).stale,
  true
);

// Invalid timestamps fail closed and never archive a record automatically.
assert.equal(
  isStaleTask(task({ created_at: "not-a-date" }), baseContext).stale,
  false
);

const route = read("app/api/crm/tasks/sweep-stale/route.ts");
const taskRoute = read("app/api/crm/tasks/[id]/route.ts");
const dashboard = read("app/crm/page.tsx");
const taskList = read("components/crm/TaskList.tsx");

assert.match(route, /TASK_RETENTION_DAYS/);
assert.match(route, /activePriorityCompanyIds/);
assert.match(route, /activeWorkstreamIds/);
assert.match(route, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(route, /\.eq\("owner_id", scope\.userId\)/);
assert.match(route, /\.eq\("assigned_to_user_id", scope\.userId\)/);
assert.match(route, /update\(\{ status: "dismissed" \}\)/);
assert.doesNotMatch(route, /\.delete\(/);
assert.match(taskRoute, /retentionTouchedAt: new Date\(\)\.toISOString\(\)/);
assert.match(dashboard, /fetch\("\/api\/crm\/tasks\/sweep-stale"\)/);
assert.match(taskList, /Pin as a priority and protect from automatic cleanup/);

console.log("Automatic task retention and user-isolation checks passed");
