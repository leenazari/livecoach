import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260822093614_personal_sales_setup.sql"
);
const api = read("app/api/crm/sales-profile/route.ts");
const helper = read("lib/sales-profile.ts");
const page = read("app/settings/sales-profile/page.tsx");
const brain = read("app/api/crm/assistant/route.ts");
const outreach = read("app/api/crm/outreach/[id]/prepare/route.ts");
const live = read("app/api/interview/suggest/route.ts");
const digest = read("app/api/cron/daily-digest/route.ts");
const teamApi = read("app/api/crm/team/route.ts");
const teamPage = read("app/settings/team/page.tsx");

assert.match(migration, /create table if not exists public\.salesperson_profiles/);
assert.match(migration, /primary key \(workspace_id, user_id\)/);
assert.match(migration, /alter table public\.salesperson_profiles enable row level security/);
assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
assert.match(migration, /wm\.status = 'active'/);
assert.match(migration, /Members read their own sales profile/);
assert.match(migration, /Members create their own sales profile/);
assert.match(migration, /Members update their own sales profile/);
assert.doesNotMatch(
  migration,
  /audit_salesperson_profile_change[\s\S]*?security definer/i,
  "The profile audit trigger must not bypass row security"
);
assert.match(migration, /insert into public\.access_audit_events/);

assert.match(api, /requireRequestScope\(\)/);
assert.match(api, /workspace_id: scope\.workspaceId/);
assert.match(api, /user_id: scope\.userId/);
assert.match(api, /upsert\(payload, \{ onConflict: "workspace_id,user_id" \}\)/);
assert.doesNotMatch(api, /body\.(?:userId|workspaceId)/);
assert.match(api, /Cache-Control": "private, no-store"/);

assert.match(helper, /getRequestScope\(\) \? supabaseAdmin : supabaseService/);
assert.match(helper, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(helper, /\.eq\("user_id", scope\.userId\)/);
assert.match(helper, /slice\(\s*0,\s*1800\s*\)/);
assert.match(helper, /never grants access to another user's records/i);
assert.match(helper, /getOptionalSalesProfile/);
assert.match(helper, /must[\s\S]*never stop the Brain/i);

for (const source of [brain, outreach, live]) {
  assert.match(source, /sales-profile/);
  assert.match(source, /salesProfile|personalProfile/);
}
assert.match(digest, /getOptionalSalesProfile/);
assert.match(digest, /Your working focus/);

assert.match(page, /Personal to your login/);
assert.match(page, /Email and calendar/);
assert.match(page, /Your notetaker/);
assert.match(page, /Live suggestion frequency/);
assert.match(page, /sm:grid-cols/);
assert.match(page, /Your entries are still here/);

assert.match(teamApi, /salesProfileComplete/);
assert.match(teamPage, /Personal Sales Setup completed/);

console.log("Personal Sales Setup checks passed");
