import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const dashboard = read("app/api/crm/dashboard/route.ts");
const dashboardPage = read("app/crm/page.tsx");
const revenueToday = read("components/crm/RevenueToday.tsx");
const quickUpdate = read("components/crm/QuickClientUpdate.tsx");
const activity = read("app/api/crm/companies/[id]/activity/route.ts");
const approval = read("app/api/crm/companies/[id]/activity/approve/route.ts");
const upcoming = read("components/crm/UpcomingCalls.tsx");
const taskList = read("components/crm/TaskList.tsx");
const workInbox = read("app/crm/inbox/page.tsx");
const workInboxRoute = read("app/api/crm/inbox/route.ts");
const upcomingRoute = read("app/api/crm/upcoming/route.ts");
const upcomingItem = read("app/api/crm/upcoming/[id]/route.ts");
const calendarSync = read("app/api/crm/calendar-sync/route.ts");
const supabase = read("lib/supabase.ts");
const migration = read(
  "supabase/migrations/20260828201920_calendar_event_exclusions.sql"
);

// Review-client-update rows carry the canonical company and source note ids.
// Both Today views expose a review link plus explicit apply and dismiss actions.
assert.match(dashboard, /entity: "activity" as const/);
assert.match(dashboard, /companyId: company\.id/);
assert.match(dashboard, /contextId: latest\.contextId/);
for (const ui of [dashboardPage, revenueToday]) {
  assert.match(ui, /entity\?: "task" \| "activity"/);
  assert.match(ui, /action: "apply" \| "dismiss"/);
  assert.match(ui, /activity\/approve/);
  assert.match(ui, /Apply the saved CRM changes/);
  assert.match(ui, /Remove this review without applying changes/);
}

// A phone, text or voice update can complete only the precise task that linked
// into the client. Safe CRM changes apply in the same user-approved save flow.
assert.match(quickUpdate, /autoApply: true/);
assert.match(quickUpdate, /completeTaskId: resolveTaskId \|\| undefined/);
assert.match(quickUpdate, /lc:tasks-updated/);
assert.match(activity, /\.eq\("id", completeTaskId\)/);
assert.match(activity, /\.eq\("company_id", params\.id\)/);
assert.match(activity, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(activity, /\.eq\("owner_id", scope\.userId\)/);
assert.match(activity, /\.eq\("status", "open"\)/);
assert.match(activity, /status: "done", done_at:/);
assert.doesNotMatch(
  activity,
  /from\("tasks"\)[\s\S]{0,500}updated_at/
);

// Dismissing a review is a durable, owner-scoped state transition rather than
// a client-only hide, so it remains gone after a refresh.
assert.match(approval, /const scope = requireRequestScope\(\)/);
assert.match(approval, /action = body\.action === "dismiss"/);
assert.match(approval, /status: "dismissed"/);
assert.match(approval, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(approval, /\.eq\("owner_id", scope\.userId\)/);

// Crossing a provider event writes a private exclusion before deleting the CRM
// row. Sync filters that exclusion and the UI invalidates Today immediately.
assert.match(upcoming, /method: "DELETE"/);
assert.match(upcoming, /lc:tasks-updated/);
assert.match(upcoming, /lc:crm-updated/);
assert.match(upcoming, /const loadSeq = useRef\(0\)/);
assert.match(upcoming, /const dismissedIds = useRef\(new Set<string>\(\)\)/);
assert.match(upcoming, /seq !== loadSeq\.current/);
assert.match(upcoming, /dismissedIds\.current\.has\(call\.id\)/);
assert.match(taskList, /if \(t\.upcoming_id\)[\s\S]{0,240}method: "DELETE"/);
assert.match(dashboard, /entity: "upcoming" as const/);
assert.match(dashboardPage, /entity\?: "task" \| "activity" \| "upcoming"/);
assert.match(dashboardPage, /dismissTodayUpcoming/);
assert.match(dashboardPage, /`\/api\/crm\/upcoming\/\$\{item\.id\}`/);
assert.match(dashboardPage, /→"\} Your task list/);
assert.match(
  dashboardPage,
  /Your task list[\s\S]*?<TaskList[\s\S]*?showCompany[\s\S]*?allowBulk/
);
assert.match(dashboardPage, /Tick to complete\. Click a task to start it/);
assert.doesNotMatch(dashboardPage, /clientlessOnly/);
assert.ok(
  dashboardPage.indexOf("Your task list") < dashboardPage.indexOf("<UpcomingCalls"),
  "The complete task list must appear above upcoming calls on Today"
);
assert.match(taskList, /body: JSON\.stringify\(\{ status: "done" \}\)/);
assert.match(taskList, /const runAction = \(t: Task, a: string\)/);
assert.match(taskList, /const saveEdit = async \(t: Task\)/);
assert.match(taskList, /const togglePin = async \(t: Task\)/);
assert.match(workInboxRoute, /kind: "prep"[\s\S]{0,1200}dismissible: true/);
assert.match(workInbox, /const dismissedItemIds = useRef\(new Set<string>\(\)\)/);
assert.match(workInbox, /item\.kind !== "prep"/);
assert.match(workInbox, /`\/api\/crm\/upcoming\/\$\{item\.sourceId\}`/);
assert.match(upcomingRoute, /resolveRecordScope\(\)/);
assert.match(upcomingRoute, /from\("upcoming_calls"\)[\s\S]{0,350}\.eq\("workspace_id", scope\.workspaceId\)[\s\S]{0,100}\.eq\("owner_id", scope\.userId\)/);
assert.match(upcomingItem, /from\("calendar_event_exclusions"\)/);
assert.match(upcomingItem, /ignoreDuplicates: true/);
assert.match(upcomingItem, /privateRecordFields\(scope\)/);
assert.match(upcomingItem, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(upcomingItem, /\.eq\("owner_id", scope\.userId\)/);
assert.match(calendarSync, /from\("calendar_event_exclusions"\)/);
assert.match(calendarSync, /from\("calendar_event_exclusions"\)[\s\S]{0,200}\.eq\("workspace_id", scope\.workspaceId\)[\s\S]{0,100}\.eq\("owner_id", scope\.userId\)/);
assert.match(calendarSync, /excludedEventIds\.has\(externalId\)/);
assert.match(supabase, /"calendar_event_exclusions"/);

// The exclusion store is private by construction and by RLS. These assertions
// are the static two-user regression guard. One account can never match or
// insert another account's owner id, even inside a shared workspace.
assert.match(migration, /visibility text not null default 'private'/);
assert.match(migration, /alter table public\.calendar_event_exclusions enable row level security/);
assert.match(migration, /owner_id = \(select auth\.uid\(\)\)/g);
assert.match(migration, /wm\.user_id = \(select auth\.uid\(\)\)/g);
assert.match(migration, /wm\.status = 'active'/g);
assert.match(migration, /grant select, insert on table public\.calendar_event_exclusions to authenticated/);
assert.doesNotMatch(migration, /grant all on table public\.calendar_event_exclusions to authenticated/);

console.log("Today state transition and two-user isolation checks passed");
