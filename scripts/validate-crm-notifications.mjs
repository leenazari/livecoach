import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260824002148_crm_user_notifications.sql"
);
const indexMigration = read(
  "supabase/migrations/20260824002943_index_crm_notifications_workspace.sql"
);
const sharedClientMigration = read(
  "supabase/migrations/20260824003124_notify_shared_client_assignments.sql"
);
const feedRoute = read("app/api/crm/notifications/route.ts");
const itemRoute = read("app/api/crm/notifications/[id]/route.ts");
const alerts = read("components/crm/NotificationAlerts.tsx");
const page = read("app/crm/notifications/page.tsx");
const nav = read("components/crm/NavMenu.tsx");

assert.match(migration, /create table public\.crm_notifications/);
assert.match(migration, /unique \(user_id, source_event_key\)/);
assert.match(
  indexMigration,
  /on public\.crm_notifications \(workspace_id, user_id\)/
);
assert.match(migration, /enable row level security/);
assert.match(
  migration,
  /grant update \(read_at, dismissed_at\)[\s\S]*to authenticated/
);
assert.doesNotMatch(
  migration,
  /grant insert[^\n]*authenticated/,
  "Browser users must not be able to forge notifications"
);
assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
assert.match(migration, /wm\.status = 'active'/);
assert.match(migration, /create schema if not exists livecoach_private/);
assert.match(migration, /revoke all on schema livecoach_private from public, anon, authenticated/);
assert.match(migration, /new\.action = 'work_assignment_changed'/);
assert.match(migration, /new\.actor_user_id[\s\S]*actor_role not in \('owner', 'manager'\)/);
assert.match(migration, /current_assignee is distinct from recipient_id/);
assert.match(migration, /recipient_id = new\.actor_user_id/);
assert.match(migration, /after update of last_reply_at on public\.outreach_prospects/);
assert.match(migration, /new\.last_reply_at is not distinct from old\.last_reply_at/);
assert.match(migration, /on conflict \(user_id, source_event_key\) do nothing/g);
assert.doesNotMatch(
  migration,
  /insert into public\.crm_notifications[\s\S]*select[\s\S]*from public\.(?:outreach_prospects|access_audit_events)/,
  "The first release must not replay historical records"
);
assert.match(
  sharedClientMigration,
  /source_table in \('outreach_prospects', 'opportunities', 'companies'\)/
);
assert.match(sharedClientMigration, /'client_sales_assignment_changed'/);
assert.match(sharedClientMigration, /'client_sales_access_shared'/);
assert.match(sharedClientMigration, /from public\.team_client_shares share/);
assert.match(sharedClientMigration, /share\.status = 'active'/);
assert.match(sharedClientMigration, /target_href := '\/crm\/' \|\| target_uuid::text/);
assert.match(
  sharedClientMigration,
  /current_assignee is distinct from recipient_id/
);
assert.match(
  sharedClientMigration,
  /revoke execute on function livecoach_private\.notify_work_assignment\(\)/
);

for (const route of [feedRoute, itemRoute]) {
  assert.match(route, /requireRequestScope\(\)/);
  assert.match(route, /\.eq\("workspace_id", account\.workspaceId\)/);
  assert.match(route, /\.eq\("user_id", account\.userId\)/);
  assert.doesNotMatch(route, /supabaseService/);
}
assert.match(feedRoute, /Cache-Control": "private, no-store/);
assert.match(feedRoute, /\.is\("dismissed_at", null\)/);
assert.match(itemRoute, /new Set\(\["read", "unread", "dismiss"\]\)/);

assert.match(alerts, /POLL_MS = 60_000/);
assert.match(alerts, /Establish a baseline without replaying old alerts/);
assert.match(alerts, /Notification\.permission === "granted"/);
assert.doesNotMatch(alerts, /requestPermission/);
assert.match(alerts, /lc:notifications-updated/);
assert.doesNotMatch(alerts, /openai|anthropic|messages\.create/i);

assert.match(page, /Notification\.requestPermission\(\)/);
assert.match(page, /onClick=\{\(\) => void enableDesktop\(\)\}/);
assert.match(page, /Each teammate has a separate private unread list/);
assert.match(page, /Mark all read/);
assert.match(page, /Dismiss/);
assert.match(page, /Popups work while your browser is running/);
assert.doesNotMatch(page, /openai|anthropic|messages\.create/i);

assert.match(nav, /href: "\/crm\/notifications"/);
assert.match(nav, /notificationCount > 0/);
assert.match(nav, /<NotificationAlerts onUnreadCount=\{setNotificationCount\}/);

console.log("CRM notification checks passed");
