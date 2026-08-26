import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260826175644_restrict_outreach_rows_to_assignee.sql"
  ),
  "utf8"
);

for (const table of [
  "outreach_prospects",
  "outreach_messages",
  "outreach_enrolments",
  "outreach_events",
]) {
  assert.match(
    migration,
    new RegExp(
      `drop policy if exists "Members read permitted records"\\s+on public\\.${table}`
    ),
    `${table} must not retain the workspace-wide read policy`
  );
  assert.match(
    migration,
    new RegExp(
      `drop policy if exists "Members update permitted records"\\s+on public\\.${table}`
    ),
    `${table} must not retain the workspace-wide update policy`
  );
}

assert.match(migration, /wm\.role in \('owner', 'manager'\)/);
assert.match(
  migration,
  /outreach_prospects\.assigned_to_user_id = \(select auth\.uid\(\)\)/
);
assert.match(
  migration,
  /outreach_prospects\.assigned_to_user_id is null/
);
assert.match(
  migration,
  /outreach_messages\.sender_user_id = \(select auth\.uid\(\)\)/
);
assert.match(
  migration,
  /prospect\.id = outreach_enrolments\.prospect_id[\s\S]*prospect\.assigned_to_user_id = \(select auth\.uid\(\)\)/
);
assert.match(
  migration,
  /message\.id = outreach_events\.message_id[\s\S]*message\.sender_user_id = \(select auth\.uid\(\)\)/
);

assert.match(
  migration,
  /create or replace function public\.protect_unassigned_outreach_prospect_work\(\)/
);
assert.match(migration, /security invoker/i);
assert.doesNotMatch(migration, /security definer/i);
assert.match(
  migration,
  /to_jsonb\(new\) - array\['assigned_to_user_id', 'updated_at'\]/
);
assert.match(
  migration,
  /new\.assigned_to_user_id = actor_id[\s\S]*new\.assigned_to_user_id is null/
);
assert.match(
  migration,
  /revoke execute on function public\.protect_unassigned_outreach_prospect_work\(\)[\s\S]*from public, anon, authenticated/
);

assert.doesNotMatch(
  migration,
  /on public\.outreach_(?:prospects|messages|enrolments|events)[\s\S]{0,160}using\s*\(\s*true\s*\)/i
);

console.log("Outreach row isolation checks passed");
