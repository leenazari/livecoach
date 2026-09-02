import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  countTaskDashboard,
  sortTaskDashboard,
  taskMatchesDashboardView,
  taskTimeBucket,
} from "../lib/task-dashboard.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const now = new Date(2026, 8, 2, 12, 0, 0, 0);
const localIso = (day, hour = 0) =>
  new Date(2026, 8, day, hour, 0, 0, 0).toISOString();
const task = (overrides = {}) => ({
  id: crypto.randomUUID(),
  status: "open",
  created_at: localIso(1, 9),
  done_at: null,
  due_at: null,
  scheduled_at: null,
  upcoming_id: null,
  payload: {},
  ...overrides,
});

const rows = [
  task({ id: "no-date" }),
  task({
    id: "overdue",
    due_at: localIso(2, 9),
    payload: { scheduledTime: true },
  }),
  task({
    id: "today",
    due_at: localIso(2),
    payload: { scheduledTime: false },
  }),
  task({ id: "upcoming", due_at: localIso(3) }),
  task({ id: "flagged", payload: { pinned: true } }),
  task({
    id: "done",
    status: "done",
    done_at: localIso(2, 10),
  }),
];

assert.equal(taskTimeBucket(rows[1], now), "overdue");
assert.equal(taskTimeBucket(rows[2], now), "today");
assert.equal(taskTimeBucket(rows[3], now), "upcoming");
assert.equal(taskTimeBucket(rows[0], now), "no_date");
assert.equal(taskMatchesDashboardView(rows[4], "flagged", now), true);
assert.equal(taskMatchesDashboardView(rows[5], "completed", now), true);

const counts = countTaskDashboard(rows, now);
assert.deepEqual(counts, {
  open: 5,
  flagged: 1,
  overdue: 1,
  today: 1,
  upcoming: 1,
  no_date: 2,
  completed: 1,
  completedToday: 1,
});
assert.equal(sortTaskDashboard(rows)[0].id, "flagged");

const nav = read("components/crm/NavMenu.tsx");
const page = read("app/crm/tasks/page.tsx");
const today = read("app/crm/page.tsx");
const board = read("app/crm/board/page.tsx");
const dashboard = read("components/crm/TaskDashboard.tsx");
const assistant = read("components/crm/GlobalAssistant.tsx");
const collectionRoute = read("app/api/crm/tasks/route.ts");
const itemRoute = read("app/api/crm/tasks/[id]/route.ts");

assert.match(nav, /TASKS_ITEM: Item = \{ href: "\/crm\/tasks", label: "Tasks"/);
assert.match(nav, /\? \[homeItem, TASKS_ITEM, CHAT_ITEM/);
assert.match(nav, /homeItem,\s+TASKS_ITEM,\s+CHAT_ITEM/);
assert.match(nav, /const BOTTOM:[\s\S]*?homeItem,[\s\S]*?TASKS_ITEM/);
assert.match(nav, /pathname\.startsWith\("\/crm\/tasks"\)/);

assert.match(page, /<TaskDashboard \/>/);
assert.match(page, /One place for every task assigned to you/);
assert.match(today, /href="\/crm\/tasks"/);
assert.match(board, /t === "tasks"[\s\S]*?router\.replace\("\/crm\/tasks"\)/);
assert.doesNotMatch(board, /<TaskList/);
assert.match(assistant, /path\.startsWith\("\/crm\/tasks"\)[\s\S]*?Tasks dashboard/);
assert.match(dashboard, /const TASKS_URL = "\/api\/crm\/tasks\?view=dashboard"/);
assert.match(dashboard, /<TaskComposer \/>/);
assert.match(dashboard, /All open/);
assert.match(dashboard, /Flagged/);
assert.match(dashboard, /Overdue/);
assert.match(dashboard, /Due today/);
assert.match(dashboard, /Upcoming/);
assert.match(dashboard, /Completed/);
assert.match(dashboard, /Search task, client or prospect/);
assert.match(dashboard, /JSON\.stringify\(\{ status \}\)/);
assert.match(dashboard, /JSON\.stringify\(\{ payload \}\)/);
assert.match(dashboard, /JSON\.stringify\(\{ text, dueAt \}\)/);
assert.match(dashboard, /result\.call\?\.prepped !== true/);
assert.match(dashboard, /lc:tasks-updated/);
assert.match(dashboard, /lc:crm-updated/);
assert.match(dashboard, /event\.detail\?\.source === "tasks-dashboard"/);

assert.match(collectionRoute, /dashboardView = searchParams\.get\("view"\) === "dashboard"/);
assert.match(collectionRoute, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(collectionRoute, /\.eq\("owner_id", account\.userId\)/);
assert.match(collectionRoute, /\.eq\("status", "done"\)/);
assert.match(collectionRoute, /\.eq\("owner_id", account\.userId\)[\s\S]*?\.not\("company_id"/);
assert.match(collectionRoute, /loadSafeSharedCompanies/);

assert.match(itemRoute, /requireRequestScope\(\)/);
assert.match(itemRoute, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(itemRoute, /\.eq\("owner_id", account\.userId\)/);
assert.match(itemRoute, /normaliseFollowUpAt/);
assert.match(itemRoute, /followUpAtIsPast/);
assert.match(itemRoute, /scheduledTime/);

const upcomingRoute = read("app/api/crm/upcoming/[id]/route.ts");
assert.match(upcomingRoute, /export async function PATCH[\s\S]*?\.eq\("workspace_id", account\.workspaceId\)[\s\S]*?\.eq\("owner_id", account\.userId\)/);

console.log("Tasks dashboard and single-source update checks passed");
