import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260825171022_salesperson_outreach_tutorial_progress.sql"
);
const route = read("app/api/crm/tutorial/route.ts");
const tutorial = read("components/crm/SalesOutreachTutorial.tsx");
const layout = read("app/crm/layout.tsx");
const nav = read("components/crm/NavMenu.tsx");
const outreach = read("app/crm/outreach/page.tsx");
const pipeline = read("components/crm/PipelineWorkspace.tsx");

assert.match(migration, /create table if not exists public\.sales_tutorial_progress/);
assert.match(migration, /primary key \(workspace_id, user_id, guide_key\)/);
assert.match(migration, /alter table public\.sales_tutorial_progress enable row level security/);
assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
assert.match(migration, /wm\.status = 'active'/);
assert.match(migration, /for update to authenticated[\s\S]*?using[\s\S]*?with check/);
assert.doesNotMatch(migration, /security definer/i);

assert.match(route, /requireRequestScope\(\)/);
assert.match(route, /GUIDE_KEY = "sales_outreach_v1"/);
assert.match(route, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(route, /\.eq\("user_id", scope\.userId\)/);
assert.match(route, /onConflict: "workspace_id,user_id,guide_key"/);
assert.match(route, /autoStart: !row && role === "sales"/);

assert.match(tutorial, /SALES_OUTREACH_TUTORIAL_STEPS: Step\[\]/);
assert.equal((tutorial.match(/\n    id: "/g) || []).length, 8);
for (const label of [
  "Check the campaign first",
  "Claim suitable unassigned prospects",
  "Build today’s ranked queue",
  "Queue research and a first draft",
  "Approve the exact message",
  "Turn positive replies into CRM context",
  "Assign and advance the opportunity",
]) assert.match(tutorial, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(tutorial, /\/prepare|\/send|supabaseAdmin/);
assert.match(tutorial, /Turn off tutorial/);
assert.match(tutorial, /lc:start-sales-tutorial/);

assert.match(layout, /<SalesOutreachTutorial \/>/);
assert.match(nav, /Sales tutorial/);
assert.match(nav, /lc:start-sales-tutorial/);
for (const target of [
  "campaign-setup",
  "prospect-pool",
  "outreach-queue",
  "reply-handover",
]) assert.match(outreach, new RegExp(`data-sales-tour="${target}"`));
assert.match(pipeline, /data-sales-tour="pipeline-assignment"/);

console.log("Sales outreach tutorial checks passed");
