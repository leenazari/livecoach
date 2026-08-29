import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260825180000_allow_shared_unassigned_outreach_pool.sql"
);
const prospectRoute = read("app/api/crm/outreach/[id]/route.ts");
const queueRoute = read("app/api/crm/outreach/queue/route.ts");
const safety = read("lib/outreach-team-safety.ts");
const outreachPage = read("app/crm/outreach/page.tsx");
const todayLane = read("components/crm/OutreachTodayLane.tsx");

assert.match(migration, /tg_table_name = 'outreach_prospects'[\s\S]*return new/);
assert.match(migration, /tg_table_name = 'outreach_messages'[\s\S]*raise exception 'an outreach sender is required'/);
assert.match(migration, /new\.assigned_to_user_id := new\.owner_id/);
assert.match(migration, /security invoker/i);
assert.doesNotMatch(migration, /security definer/i);
assert.match(migration, /NULL means it is available in the shared team pool/);

assert.match(prospectRoute, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(prospectRoute, /claimingUnassigned/);
assert.match(prospectRoute, /\.is\("assigned_to_user_id", null\)/);
assert.match(prospectRoute, /Another teammate claimed this prospect first/);

assert.match(queueRoute, /\.is\("assigned_to_user_id", null\)/);
assert.match(queueRoute, /Another teammate claimed this prospect first/);
assert.match(
  queueRoute,
  /const existing = await loadQueue\(account\.userId, account\.workspaceId\)/,
  "The daily hard limit counts queued work from every campaign"
);
assert.match(
  queueRoute,
  /\.in\("status", \["imported", "queued", "ready"\]\)/,
  "Prepared first-touch work can return to today's queue"
);
assert.match(
  queueRoute,
  /\["paused", "queued", "researched", "drafted", "approved"\]\.includes\(existingEnrolment\.status\)/
);
assert.match(safety, /"paused"/);

// Salespeople land on a useful but still isolated view. They see their own
// prospects plus unassigned inventory, never another salesperson's assigned
// work unless they deliberately choose a wider read-only filter.
assert.match(outreachPage, /setOwnerFilter\(data\.canManageAssignments === true \? "all" : "available"\)/);
assert.match(outreachPage, /ownerFilter === "available"[\s\S]*?!prospect\.assigned_to_user_id[\s\S]*?prospect\.assigned_to_user_id === currentUser/);
assert.match(outreachPage, /<option value="available">Mine and available<\/option>/);
assert.match(outreachPage, /initialQueueFillAttemptedRef/);
assert.match(outreachPage, /Fill today's remaining/);
assert.match(todayLane, /initialQueueFillAttemptedRef/);
assert.match(todayLane, /Entering Sales Today should supply the full free-to-rank worklist/);

console.log("Shared outreach pool checks passed");
