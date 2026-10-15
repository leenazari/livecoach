import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const workspace = "20000000-0000-4000-8000-000000000001";
const outside = "20000000-0000-4000-8000-000000000002";
const migration = readFileSync(new URL(
  "../supabase/migrations/20261015124633_require_active_task_membership.sql", import.meta.url
), "utf8");

await db.exec(`
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to authenticated, service_role;
  create table public.workspace_members(workspace_id uuid, user_id uuid, status text);
  create table public.tasks(id text primary key, workspace_id uuid, owner_id uuid, visibility text, text text);
  grant select on public.workspace_members to authenticated;
  grant all on public.tasks to authenticated, service_role;
  alter table public.workspace_members enable row level security;
  create policy "Members read their own membership" on public.workspace_members
    for select to authenticated using (user_id=(select auth.uid()));
  alter table public.tasks enable row level security;
  -- Match the existing permissive ownership rules, which the migration keeps.
  create policy "Members read permitted records" on public.tasks for select to authenticated
    using (owner_id=(select auth.uid()) or (visibility='team' and exists (
      select 1 from public.workspace_members m where m.workspace_id=tasks.workspace_id
        and m.user_id=(select auth.uid()) and m.status='active')));
  create policy "Members create records in their workspace" on public.tasks for insert to authenticated
    with check (owner_id=(select auth.uid()) and exists (
      select 1 from public.workspace_members m where m.workspace_id=tasks.workspace_id
        and m.user_id=(select auth.uid()) and m.status='active'));
  create policy "Members update permitted records" on public.tasks for update to authenticated
    using (owner_id=(select auth.uid()) or (visibility='team' and exists (
      select 1 from public.workspace_members m where m.workspace_id=tasks.workspace_id
        and m.user_id=(select auth.uid()) and m.status='active')))
    with check (exists (select 1 from public.workspace_members m where m.workspace_id=tasks.workspace_id
      and m.user_id=(select auth.uid()) and m.status='active')
      and (visibility='team' or owner_id=(select auth.uid())));
  create policy "Owners delete permitted records" on public.tasks for delete to authenticated
    using (owner_id=(select auth.uid()));
`);
await db.query("insert into public.workspace_members values ($1,$2,'active'),($1,$3,'active'),($4,$2,'suspended')", [workspace, alice, bob, outside]);
await db.query(`insert into public.tasks values
  ('alice-private',$1,$2,'private','Keep Alice history'),
  ('bob-private',$1,$3,'private','Keep Bob history'),
  ('team',$1,$2,'team','Shared team task'),
  ('foreign',$4,$2,'private','Other workspace history')`, [workspace, alice, bob, outside]);

async function asUser(userId, run) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec("set role authenticated");
  try { return await run(); } finally { await db.exec("reset role"); }
}
const visible = async () => (await db.query("select id from public.tasks order by id")).rows.map((r) => r.id);
await db.query("update public.workspace_members set status='removed' where user_id=$1 and workspace_id=$2", [alice, workspace]);
assert.equal((await asUser(alice, visible)).length, 3, "Reproduce old-token access after membership removal");
await db.exec(migration);
await db.exec(migration);

for (const status of ["removed", "suspended", "onboarding"]) {
  await db.query("update public.workspace_members set status=$1 where user_id=$2 and workspace_id=$3", [status, alice, workspace]);
  await asUser(alice, async () => {
    assert.deepEqual(await visible(), [], status);
    assert.equal((await db.query("update public.tasks set text='Forbidden' where id='alice-private' returning id")).rows.length, 0);
    assert.equal((await db.query("delete from public.tasks where id='alice-private' returning id")).rows.length, 0);
    await assert.rejects(() => db.query("insert into public.tasks values('blocked',$1,$2,'private','Blocked')", [workspace, alice]), /row-level security/i);
  });
  assert.deepEqual(await asUser(bob, visible), ["bob-private", "team"], "Another active teammate retains access");
}
await db.query("delete from public.workspace_members where user_id=$1 and workspace_id=$2", [alice, workspace]);
assert.deepEqual(await asUser(alice, visible), [], "Missing membership also denies old-token access");
await db.query("insert into public.workspace_members values($1,$2,'active')", [workspace, alice]);
await asUser(alice, async () => {
  assert.deepEqual(await visible(), ["alice-private", "team"], "Active ownership and shared-task access remain intact");
  assert.equal((await db.query("update public.tasks set text='Allowed' where id='alice-private' returning id")).rows.length, 1);
  assert.equal((await db.query("update public.tasks set text='Forbidden' where id='bob-private' returning id")).rows.length, 0);
  assert.equal((await db.query("delete from public.tasks where id='bob-private' returning id")).rows.length, 0);
  await assert.rejects(() => db.query("update public.tasks set workspace_id=$1 where id='alice-private'", [outside]), /row-level security/i);
  await db.query("insert into public.tasks values('new-own',$1,$2,'private','New task')", [workspace, alice]);
  assert.equal((await db.query("delete from public.tasks where id='new-own' returning id")).rows.length, 1);
});
await db.exec("set role service_role");
assert.equal((await db.query("select count(*)::int as count from public.tasks")).rows[0].count, 4, "History remains available to authorised server operations");
await db.exec("reset role");
assert.equal((await db.query("select count(*)::int as count from pg_policies where tablename='tasks' and permissive='PERMISSIVE'")).rows[0].count, 4, "Keep every existing ownership rule");
await db.close();
console.log("Removed-member task RLS passed. Old tokens, all write operations, suspended/onboarding/missing membership, two users, workspace isolation and preserved history verified.");
