import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260826090206_salesperson_outreach_tutorial_progress.sql"
);
const route = read("app/api/crm/tutorial/route.ts");
const tutorial = read("components/crm/SalesOutreachTutorial.tsx");
const tutorialConfig = read("lib/sales-tutorial.ts");
const layout = read("app/crm/layout.tsx");
const settingsLayout = read("app/settings/layout.tsx");
const nav = read("components/crm/NavMenu.tsx");
const outreach = read("app/crm/outreach/page.tsx");
const pipeline = read("components/crm/PipelineWorkspace.tsx");
const readiness = read("app/settings/readiness/page.tsx");
const calls = read("app/crm/calls/page.tsx");

assert.match(migration, /create table if not exists public\.sales_tutorial_progress/);
assert.match(migration, /primary key \(workspace_id, user_id, guide_key\)/);
assert.match(migration, /alter table public\.sales_tutorial_progress enable row level security/);
assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
assert.match(migration, /wm\.status = 'active'/);
assert.match(migration, /for update to authenticated[\s\S]*?using[\s\S]*?with check/);
assert.doesNotMatch(migration, /security definer/i);

assert.match(route, /requireRequestScope\(\)/);
assert.match(route, /SALES_TUTORIAL_GUIDE_KEY/);
assert.match(route, /SALES_TUTORIAL_LAST_STEP/);
assert.match(route, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(route, /\.eq\("user_id", scope\.userId\)/);
assert.match(route, /onConflict: "workspace_id,user_id,guide_key"/);
assert.match(route, /autoStart: !row && role === "sales"/);

assert.match(tutorialConfig, /SALES_TUTORIAL_GUIDE_KEY = "sales_workflow_v2"/);
assert.match(tutorialConfig, /SALES_TUTORIAL_LAST_STEP/);
assert.equal((tutorialConfig.match(/\n    id: "/g) || []).length, 8);
assert.equal((tutorialConfig.match(/\n    demo: \{/g) || []).length, 8);
for (const label of [
  "Make your account ready before selling",
  "Choose the campaign, message and next step",
  "Claim the right lead and place them in today’s flow",
  "Research, inspect and approve without waiting",
  "Send safely and turn the reply into action",
  "Prepare, start and capture the conversation",
  "Advance one canonical deal and date the next move",
]) assert.match(tutorialConfig, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(tutorialConfig, /Fictional prospect/);
assert.match(tutorialConfig, /Personal LiveCoach notetaker/);
assert.match(tutorialConfig, /Voice script · ready, audio not charged yet/);
assert.match(tutorialConfig, /Phone calls can be logged afterwards by typing or voice/);
assert.doesNotMatch(tutorialConfig, /\/prepare|\/send|supabaseAdmin/);
assert.match(tutorial, /Preview only/);
assert.match(tutorial, /Turn off tutorial/);
assert.match(tutorial, /lc:start-sales-tutorial/);
assert.match(tutorial, /requestedStepId/);

assert.match(layout, /<SalesOutreachTutorial \/>/);
assert.match(settingsLayout, /<SalesOutreachTutorial \/>/);
assert.match(nav, /Sales tutorial/);
assert.match(nav, /lc:start-sales-tutorial/);
for (const target of [
  "campaign-setup",
  "prospect-pool",
  "outreach-queue",
  "reply-handover",
]) assert.match(outreach, new RegExp(`data-sales-tour="${target}"`));
assert.match(pipeline, /data-sales-tour="pipeline-assignment"/);
assert.match(readiness, /data-sales-tour="account-readiness"/);
assert.match(calls, /data-sales-tour="calls-workspace"/);

console.log("Sales outreach tutorial checks passed");
