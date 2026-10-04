import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { calendarNotificationHash, googleCalendarNotification, microsoftCalendarNotification } from "../lib/calendar-notification-auth.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const db = new PGlite();
const ws = "10000000-0000-4000-8000-000000000001";
const otherWs = "10000000-0000-4000-8000-000000000002";
const alice = "20000000-0000-4000-8000-000000000001";
const bob = "20000000-0000-4000-8000-000000000002";
const channelA = "30000000-0000-4000-8000-000000000001";
const channelB = "30000000-0000-4000-8000-000000000002";
const tokenA = randomBytes(32).toString("base64url");
const tokenB = randomBytes(32).toString("base64url");
const hashA = calendarNotificationHash(tokenA);
const hashB = calendarNotificationHash(tokenB);

const headers = new Headers({ "x-goog-channel-id": channelA, "x-goog-channel-token": tokenA,
  "x-goog-resource-id": "resource-a", "x-goog-message-number": "9007199254740993", "x-goog-resource-state": "exists" });
const google = googleCalendarNotification(headers);
assert.equal(google.p_message_number, "9007199254740993", "No integer precision loss in provider sequence numbers");
assert.equal(google.p_token_hash, hashA);
for (const field of ["x-goog-channel-token", "x-goog-resource-id", "x-goog-message-number", "x-goog-resource-state"]) {
  const invalid = new Headers(headers); invalid.set(field, "bad");
  if (field === "x-goog-resource-id") invalid.set(field, "");
  assert.equal(googleCalendarNotification(invalid), null);
}
assert.equal(microsoftCalendarNotification(channelB, { subscriptionId: "sub-b", clientState: tokenB, changeType: "deleted" }).p_external_id, "sub-b");
assert.equal(microsoftCalendarNotification(channelB, { subscriptionId: "sub-b", clientState: tokenA, lifecycleEvent: "reauthorizationRequired" }).p_lifecycle, "reauthorizationRequired");
assert.equal(microsoftCalendarNotification(channelB, { subscriptionId: "sub-b", clientState: "bad", changeType: "deleted" }), null);
assert.equal(microsoftCalendarNotification(channelB, { subscriptionId: "sub-b", clientState: tokenB, changeType: "anything" }), null);

await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key);
  create table public.workspaces(id uuid primary key);
  create table public.workspace_members(workspace_id uuid, user_id uuid, status text);
  create table public.google_oauth(workspace_id uuid, owner_id uuid, email text, refresh_token text);
  create table public.microsoft_oauth(workspace_id uuid, owner_id uuid, email text, refresh_token text);
  grant usage on schema public to service_role;
  grant select on public.workspace_members, public.google_oauth, public.microsoft_oauth to service_role;
`);
await db.exec(read("supabase/migrations/20261004173952_calendar_change_notifications.sql"));
await db.query("insert into auth.users values($1),($2)", [alice, bob]);
await db.query("insert into public.workspaces values($1),($2)", [ws, otherWs]);
await db.query("insert into public.workspace_members values($1,$2,'active'),($1,$3,'active')", [ws, alice, bob]);
await db.query("insert into public.google_oauth values($1,$2,'alice@example.test','not-a-real-token')", [ws, alice]);
await db.query("insert into public.microsoft_oauth values($1,$2,'bob@example.test','not-a-real-token')", [ws, bob]);
for (const [id, owner, provider, email, hash] of [[channelA, alice, "google", "alice@example.test", hashA], [channelB, bob, "microsoft", "bob@example.test", hashB]]) {
  await db.query(`insert into public.calendar_notification_channels(id,workspace_id,owner_id,provider,calendar_id,connection_email,token_hash,expires_at)
    values($1,$2,$3,$4,'primary',$5,$6,now()+interval '7 days')`, [id, ws, owner, provider, email, hash]);
}
await db.exec("set role service_role");
const accept = async (id, hash, external, resource = null, sequence = null, lifecycle = null) =>
  (await db.query("select * from public.accept_calendar_change($1,$2,$3,$4,$5,$6)", [id, hash, external, resource, sequence, lifecycle])).rows;
const request = async (owner, workspace = ws, mode = "full") => (await db.query("select public.request_calendar_sync($1,$2,$3) as ok", [workspace, owner, mode])).rows[0].ok;
const claim = async (owner, workspace = ws) => (await db.query("select * from public.claim_calendar_sync($1,$2)", [workspace, owner])).rows[0];
const finish = async (owner, job, error = null) => (await db.query("select public.finish_calendar_sync($1,$2,$3,$4,$5) as ok", [ws, owner, job.lease_token, job.requested_version, error])).rows[0].ok;

assert.equal((await accept(channelA, hashB, channelA, "resource-a", 1)).length, 0, "Wrong token is rejected");
assert.equal((await accept(channelA, hashA, channelA, "resource-a", 1))[0].owner_id, alice, "Early Google sync notification binds pending resource");
assert.equal((await accept(channelA, hashA, channelA, "other-resource", 2)).length, 0, "Resource mismatch is rejected");
assert.equal((await accept(channelA, hashA, channelA, "resource-a", 1)).length, 0, "Duplicate notification is ignored");
assert.equal((await accept(channelA, hashA, channelA, "resource-a", 0)).length, 0, "Out-of-order notification is ignored");
assert.equal(await request(alice, otherWs), false, "Wrong workspace cannot create jobs");
assert.equal(await claim(alice, otherWs), undefined);
assert.equal(await claim(bob), undefined, "Alice's notification never creates Bob's job");
const first = await claim(alice);
assert.equal(first.requested_version, 1);
assert.equal(await claim(alice), undefined, "Concurrent workers cannot hold the same lease");
assert.equal(await finish(bob, first), false, "A different account cannot finish a lease");
await accept(channelA, hashA, channelA, "resource-a", 10);
assert.equal(await finish(alice, first), true);
const changedWhileRunning = await claim(alice);
assert.equal(changedWhileRunning.requested_version, 2, "A change during sync survives completion of the older version");
assert.equal(await finish(alice, first), false, "Stale worker cannot finish the newer lease");
await finish(alice, changedWhileRunning, "provider_503");
assert.equal(await claim(alice), undefined, "Failures back off without losing work");
await db.query("update public.calendar_sync_jobs set next_attempt_at=now()-interval '1 second' where owner_id=$1", [alice]);
const retry = await claim(alice);
assert.equal(retry.requested_version, 2);
await finish(alice, retry);
assert.equal(await claim(alice), undefined, "Completed snapshots are not repeatedly reprocessed");

assert.equal((await accept(channelB, hashB, "sub-b", null, null, "reauthorizationRequired"))[0].owner_id, bob);
assert.equal((await accept(channelB, hashB, "sub-other")).length, 0, "Microsoft subscription ID is checked as well as clientState");
assert.equal((await db.query("select needs_renewal from public.calendar_notification_channels where id=$1", [channelB])).rows[0].needs_renewal, true);
await db.exec("reset role");
await db.query("update public.workspace_members set status='suspended' where user_id=$1", [bob]);
await db.exec("set role service_role");
assert.equal((await accept(channelB, hashB, "sub-b")).length, 0, "Suspended account cannot enqueue work");
assert.equal(await claim(bob), undefined, "Suspended account cannot claim existing work");
await db.exec("reset role");
await db.query("update public.google_oauth set email='replacement@example.test' where owner_id=$1", [alice]);
await db.exec("set role service_role");
assert.equal((await accept(channelA, hashA, channelA, "resource-a", 11)).length, 0, "A reconnected mailbox cannot accept notifications for the old mailbox");
await db.exec("reset role");
await db.query("update public.google_oauth set email='alice@example.test',refresh_token=null where owner_id=$1", [alice]);
await db.exec("set role service_role");
assert.equal((await accept(channelA, hashA, channelA, "resource-a", 12)).length, 0, "Disconnected mailbox cannot enqueue work");
await db.exec("reset role");
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => db.query("select * from public.calendar_notification_channels"), /permission denied/);
  await assert.rejects(() => request(alice), /permission denied/);
  await assert.rejects(() => accept(channelA, hashA, channelA, "resource-a", 13), /permission denied/);
  await db.exec("reset role");
}
await db.close();

const calendar = read("app/api/crm/calendar-sync/route.ts");
assert.match(calendar, /claimCalendarSync\(scope\)/);
assert.match(calendar, /finishCalendarSync\(scope, job, failure\)/);
assert.match(calendar, /notetaker_schedule_failed/);
assert.match(calendar, /\.eq\("workspace_id", body.workspaceId\).*\.eq\("user_id", body.userId\).*\.eq\("status", "active"\)/);
for (const provider of ["google", "microsoft"]) {
  const webhook = read(`app/api/webhooks/calendar/${provider}/route.ts`);
  assert.ok(webhook.indexOf('rpc("accept_calendar_change"') < webhook.indexOf("waitUntil(kickCalendarSync"), "Durable write precedes dispatch");
  assert.doesNotMatch(webhook, /getRequestScope|req\.cookies|transcript|runCalendarSync/);
  assert.match(read(`app/api/auth/${provider}/callback/route.ts`), /startConnectedCalendarSync/);
  assert.match(read(`app/api/auth/${provider}/disconnect/route.ts`), /disableCalendarWatches/);
}
const watches = read("lib/calendar-watches.ts");
assert.match(watches, /VERCEL_ENV !== "production"/);
assert.match(watches, /calendarList\/watch/);
assert.match(watches, /created,updated,deleted/);
assert.match(watches, /connection_email: email, token_hash:/);
assert.match(watches, /\.eq\("workspace_id", scope.workspaceId\)\.eq\("owner_id", scope.userId\)/);
const recovery = read("app/api/cron/calendar-notifications/route.ts");
assert.match(recovery, /\.eq\("pending", true\)/);
assert.doesNotMatch(recovery, /listConnectedCalendarSnapshot/);
console.log("Calendar push authentication, two-user isolation, queue coalescing, retry and lifecycle checks passed");
