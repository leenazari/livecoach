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
assert.match(safety, /"paused"/);

console.log("Shared outreach pool checks passed");
