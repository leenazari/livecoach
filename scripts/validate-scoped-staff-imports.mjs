import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolveOutreachImportAssignee } from "../lib/outreach-import-permissions.ts";

// Run against a disposable PostgreSQL engine, never the live customer database.
// PGLITE_MODULE may point to an externally installed @electric-sql/pglite@0.5.8.
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const workspace = "10000000-0000-4000-8000-000000000001";
const elsewhere = "10000000-0000-4000-8000-000000000002";
const owner = "20000000-0000-4000-8000-000000000001";
const first = "20000000-0000-4000-8000-000000000002";
const second = "20000000-0000-4000-8000-000000000003";
const unapproved = "20000000-0000-4000-8000-000000000004";

assert.equal(resolveOutreachImportAssignee({ userId: first, role: "sales" }, null), first);
assert.equal(resolveOutreachImportAssignee({ userId: second, role: "sales" }, second), second);
assert.throws(() => resolveOutreachImportAssignee({ userId: first, role: "sales" }, second), /yourself/);
assert.equal(resolveOutreachImportAssignee({ userId: owner, role: "owner" }, second), second);
assert.equal(resolveOutreachImportAssignee({ userId: owner, role: "owner" }, null), null);

await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.workspaces (id uuid primary key);
  create table public.workspace_members (
    workspace_id uuid, user_id uuid, role text, status text,
    primary key (workspace_id, user_id)
  );
  create function public.brain_touch_updated_at() returns trigger language plpgsql as
    $$ begin new.updated_at := now(); return new; end $$;
  create table public.contacts (workspace_id uuid, email text);
  create table public.outreach_prospects (
    id uuid primary key default gen_random_uuid(), owner_id uuid, workspace_id uuid,
    visibility text, assigned_to_user_id uuid, email text, first_name text, last_name text,
    job_title text, company_name text, company_domain text, website text, industry text,
    phone text, person_linkedin_url text, company_linkedin_url text, status text,
    suppression_reason text, source_file text, source_row integer, source_metadata jsonb,
    last_researched_at timestamptz, last_contacted_at timestamptz, last_reply_at timestamptz,
    research jsonb, crm_company_id uuid,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (owner_id, email)
  );
  create table public.outreach_enrolments (prospect_id uuid);
  create table public.outreach_messages (prospect_id uuid);
  create table public.outreach_events (prospect_id uuid);
  grant usage on schema public, auth to authenticated;
  grant select on public.workspace_members to authenticated;
`);
await db.exec(read("supabase/migrations/20260903000658_staged_outreach_imports.sql"));
await db.exec(read("supabase/migrations/20260910142233_scoped_staff_outreach_imports.sql"));
await db.query("insert into auth.users (id) select unnest($1::uuid[])", [[owner, first, second, unapproved]]);
await db.query("insert into public.workspaces (id) values ($1),($2)", [workspace, elsewhere]);
for (const id of [owner, first, second, unapproved]) {
  await db.query("insert into public.workspace_members values ($1,$2,$3,'active')", [workspace, id, id === owner ? "owner" : "sales"]);
}
await db.query("insert into public.outreach_import_permissions (workspace_id,user_id,granted_by_user_id) values ($1,$2,$4),($1,$3,$4)", [workspace, first, second, owner]);

const allowed = async (actor, ws = workspace) => (await db.query(
  "select public.can_stage_outreach_import_service($1,$2) as allowed", [ws, actor]
)).rows[0].allowed;
assert.equal(await allowed(owner), true);
assert.equal(await allowed(first), true);
assert.equal(await allowed(second), true);
assert.equal(await allowed(unapproved), false);
assert.equal(await allowed(first, elsewhere), false);
await db.query("update public.workspace_members set status='suspended' where user_id=$1", [first]);
assert.equal(await allowed(first), false);
await db.query("update public.workspace_members set status='active' where user_id=$1", [first]);
await db.query("update public.outreach_import_permissions set enabled=false where user_id=$1", [second]);
assert.equal(await allowed(second), false);
await db.query("update public.outreach_import_permissions set enabled=true where user_id=$1", [second]);

const row = (email, extras = {}) => ({ email, companyName: "Synthetic Test Company", rowNumber: 2, decision: "ready", importStatus: "imported", ...extras });
const batch = async (actor, assignee, rows, ws = workspace) => (await db.query(
  "insert into public.crm_import_batches (workspace_id,owner_id,assigned_to_user_id,source_name,rows,row_count,ready_count) values ($1,$2,$3,'Synthetic test',$4::jsonb,$5,$5) returning id",
  [ws, actor, assignee, JSON.stringify(rows), rows.length]
)).rows[0].id;
const apply = async (actor, id, ws = workspace) => (await db.query(
  "select public.apply_outreach_import_batch_service($1,$2,$3) as result", [ws, actor, id]
)).rows[0].result;
const undo = async (actor, id) => (await db.query(
  "select public.undo_outreach_import_batch_service($1,$2,$3) as result", [workspace, actor, id]
)).rows[0].result;

const firstBatch = await batch(first, first, [row("overlap@example.invalid"), row("first@example.invalid")]);
const secondBatch = await batch(second, second, [row("overlap@example.invalid"), row("second@example.invalid")]);
await assert.rejects(apply(second, firstBatch), /not found/);
await assert.rejects(apply(first, firstBatch, elsewhere), /import access/);
await assert.rejects(apply(unapproved, firstBatch), /import access/);
const badAssignment = await batch(first, second, [row("bad-assignment@example.invalid")]);
await assert.rejects(apply(first, badAssignment), /yourself/);
const unassigned = await batch(first, null, [row("unassigned@example.invalid")]);
await assert.rejects(apply(first, unassigned), /yourself/);

assert.equal((await apply(first, firstBatch)).inserted, 2);
assert.equal((await apply(first, firstBatch)).inserted, 2); // Idempotent receipt.
const secondResult = await apply(second, secondBatch);
assert.equal(secondResult.inserted, 1);
assert.equal(secondResult.skippedAtApply, 1); // Duplicate created after preview.
const records = (await db.query("select email,owner_id,assigned_to_user_id from public.outreach_prospects")).rows;
assert.equal(records.length, 3);
assert.ok(records.every((item) => item.owner_id === item.assigned_to_user_id));

await db.query("insert into public.contacts values ($1,'contact@example.invalid')", [workspace]);
const qualityBatch = await batch(first, first, [
  row("contact@example.invalid"), row("invalid"), row("missing@example.invalid", { companyName: "" }),
  row("excluded@example.invalid", { decision: "review" }),
  row("suppressed@example.invalid", { importStatus: "suppressed", sourceStatus: "do not contact" }),
]);
assert.equal((await apply(first, qualityBatch)).inserted, 1);
assert.equal((await db.query("select status from public.outreach_prospects where email='suppressed@example.invalid'")).rows[0].status, "suppressed");
assert.equal((await db.query("select count(*)::int as count from public.outreach_enrolments")).rows[0].count, 0);
assert.equal((await db.query("select count(*)::int as count from public.outreach_messages")).rows[0].count, 0);
await assert.rejects(undo(second, firstBatch), /not found/);
await db.query("update public.outreach_prospects set assigned_to_user_id=$1 where email='first@example.invalid'", [second]);
const undone = await undo(first, firstBatch);
assert.equal(undone.removed, 1);
assert.equal(undone.protected, 1); // Another member's reassigned work stays intact.
assert.equal((await undo(first, firstBatch)).removed, 1);

// Browser-facing table access cannot disclose another uploader's preview or
// let a salesperson self-grant permission, and service RPCs are not public.
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [first]);
await db.exec("set role authenticated");
const visible = (await db.query("select owner_id from public.crm_import_batches")).rows;
assert.ok(visible.length > 0 && visible.every((item) => item.owner_id === first));
const permissions = (await db.query("select user_id from public.outreach_import_permissions")).rows;
assert.deepEqual(permissions.map((item) => item.user_id), [first]);
await assert.rejects(db.query("insert into public.outreach_import_permissions (workspace_id,user_id,granted_by_user_id) values ($1,$2,$2)", [workspace, unapproved]), /permission denied/);
await assert.rejects(apply(first, qualityBatch), /permission denied/);
await db.exec("reset role");
await db.close();
console.log("Scoped staff imports: assignment, isolation, duplicate checks, suppression, undo and RLS passed");
