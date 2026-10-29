import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
assert.match(
  read("supabase/migrations/20261029102138_claim_manual_notetaker_dispatch.sql"),
  /add column if not exists manual_dispatch_claimed_at timestamptz/i
);
const load = (file, dependency) => {
  const module = { exports: {} };
  const source = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "module", "exports", source)(dependency, module, module.exports);
  return module.exports;
};
const ws = "00000000-0000-4000-8000-000000000001";
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const eventA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let scope = { workspaceId: ws, userId: alice };
let browser = false;
const scheduledAt = new Date(Date.now() + 86400000).toISOString();
const rows = {
  workspace_members: [alice, bob].map((user_id) => ({ user_id, workspace_id: ws, status: "active", transcriber_daily_minutes_limit: 360 })),
  upcoming_calls: [eventA, eventB].map((id, i) => ({ id, owner_id: i ? bob : alice, workspace_id: ws, scheduled_at: scheduledAt,
    meeting_url: "https://meet.google.com/abc-defg-hij", source: "manual", completed_at: null, title: "Team call", prep: null, visibility: "private" })),
  meet_bots: [], meet_capture_subscribers: [], meet_stream_tokens: [], interview_sessions: [],
};
const queries = [], providerCreates = [], providerEdits = [], providerDeletes = [];
const deleteStatusByBot = new Map();
let editStatus = 200;
let counter = 0;
const db = { from(table) {
  assert.ok(rows[table], `Unexpected database table ${table}`);
  const query = { table, filters: [], operation: "select" };
  queries.push(query);
  const predicates = [];
  let payload, single = false, limit = Infinity, options = {};
  const builder = {
    select() { return this; }, order() { return this; },
    insert(value) { query.operation = "insert"; payload = value; return this; },
    upsert(value, valueOptions = {}) { query.operation = "upsert"; payload = value; options = valueOptions; return this; },
    update(value) { query.operation = "update"; payload = value; return this; },
    eq(key, value) { query.filters.push([key, value]); predicates.push((r) => r[key] === value); return this; },
    in(key, values) { predicates.push((r) => values.includes(r[key])); return this; },
    is(key, value) { query.filters.push([key, value]); predicates.push((r) => r[key] === value); return this; },
    not(key, _operator, value) { predicates.push((r) => r[key] !== value); return this; },
    gte(key, value) { predicates.push((r) => r[key] >= value); return this; },
    lt(key, value) { query.filters.push([key, value]); predicates.push((r) => r[key] < value); return this; },
    // Exercise the real service-scoping wrapper, including its owner/team OR.
    or(value) { const owner = value.match(/^owner_id\.eq\.([^,]+),visibility.eq.team$/)?.[1]; assert.ok(owner); predicates.push((r) => r.owner_id === owner || r.visibility === "team"); return this; },
    limit(value) { limit = value; return this; },
    single() { single = true; return this; }, maybeSingle() { single = true; return this; },
    then(resolve, reject) {
      let found;
      if (["insert", "upsert"].includes(query.operation)) {
        found = (Array.isArray(payload) ? payload : [payload]).map((value) => {
          const existing = query.operation === "upsert" && options.onConflict && rows[table].find((r) => options.onConflict.split(",").every((key) => r[key] === value[key]));
          if (existing) { if (!options.ignoreDuplicates) Object.assign(existing, value); return existing; }
          const row = { id: `row-${++counter}`, created_at: new Date().toISOString(), ended_at: null, manual_dispatch_claimed_at: null, ...value };
          rows[table].push(row);
          return row;
        });
      } else {
        found = rows[table].filter((r) => predicates.every((p) => p(r))).slice(0, limit);
        if (query.operation === "update") found.forEach((r) => Object.assign(r, payload));
      }
      return Promise.resolve({ data: single ? found[0] || null : found, error: null }).then(resolve, reject);
    },
  };
  return builder;
} };

// Load the real database gateway. The regression only occurred on unattended
// service requests, because workspace_members is not a CRM record table.
const database = load("lib/supabase.ts", (name) => {
  if (name === "server-only") return {};
  if (name === "@supabase/supabase-js") return { createClient: () => db };
  if (name.endsWith("request-scope")) return { getRequestScope: () => browser ? { ...scope, accessToken: "fixture" } : null, isVerifiedServiceRequest: () => !browser };
  if (name.endsWith("service-scope")) return { getServiceRecordScope: () => scope };
  throw new Error(name);
});
assert.throws(() => database.supabaseAdmin.from("workspace_members"), /explicit admin client/, "Do not relax the shared database boundary to fix scheduling");
const scoped = { resolveRecordScope: async () => scope, privateRecordFields: (s) => ({ workspace_id: s.workspaceId, owner_id: s.userId, visibility: "private" }) };
const next = { NextRequest: Request, NextResponse: { json: (data, options) => Response.json(data, options) } };
const dependencies = (name) => {
  if (name === "server-only") return {};
  if (name === "next/server") return next;
  if (name.endsWith("supabase")) return database;
  if (name.endsWith("record-scope")) return scoped;
  if (name.endsWith("shared-call-access")) return { resolveSharedCalendarOccurrence: async () => null, grantSharedCaptureAccess: async () => { throw new Error("Unexpected shared grant"); } };
  if (name.endsWith("recall-scheduled-bot")) return {
    ...load("lib/recall-scheduled-bot.ts", dependencies),
    cancelScheduledNotetakers: async () => { throw new Error("Unexpected reservation detach"); },
    cancelRecallBotRequest: async () => { throw new Error("Unexpected bot removal"); },
  };
  if (name.endsWith("transcriber")) return {
    ...load("lib/transcriber.ts", dependencies), getTranscriberIdentity: async (id) => ({ botName: `Notetaker ${id}`, coachHints: [], languageCode: "en" }),
  };
  if (name.startsWith("@/lib/")) return load(`${name.slice(2)}.ts`, dependencies);
  return require(name);
};
const route = load("app/api/meet/start/route.ts", dependencies);
const scheduler = load("lib/automatic-precall.ts", (name) => name === "@/app/api/meet/start/route" ? route : dependencies(name));
const savedFetch = globalThis.fetch;
const env = { key: process.env.RECALL_API_KEY, region: process.env.RECALL_REGION };
process.env.RECALL_API_KEY = "fixture-not-a-credential";
process.env.RECALL_REGION = "fixture";
globalThis.fetch = async (_url, init) => {
  if (!init?.method) return Response.json({ status_changes: [], join_at: rows.meet_bots[0].scheduled_join_at });
  if (init?.method === "DELETE") {
    const botId = decodeURIComponent(String(_url).match(/\/bot\/([^/]+)\/$/)?.[1] || "");
    providerDeletes.push(botId);
    const status = deleteStatusByBot.get(botId) || 204;
    return status === 204
      ? new Response(null, { status })
      : Response.json({ code: status === 404 ? "not_found" : "cannot_delete_bot" }, { status });
  }
  if (init?.method === "PATCH") {
    const body = JSON.parse(init.body);
    providerEdits.push(body);
    const botId = decodeURIComponent(String(_url).match(/\/bot\/([^/]+)\/$/)?.[1] || "");
    return Response.json(editStatus === 200 ? { id: botId, ...body } : { code: "update_bot_failed" }, { status: editStatus });
  }
  assert.equal(init?.method, "POST", "Only one mocked provider create is expected per private calendar event");
  const body = JSON.parse(init.body);
  providerCreates.push(body);
  return Response.json({ id: `bot-${providerCreates.length}` });
};
try {
  const result = await scheduler.scheduleAutomaticNotetakersForUpcomingIds([eventA, eventB]);
  assert.equal(result.failed, 0, `Unattended scheduling must work through the real service boundary, got ${JSON.stringify(result)}`);
  assert.equal(result.scheduled, 1);
  assert.equal(providerCreates.length, 1, "The other account's event is not scheduled by this account");
  assert.equal(providerCreates[0].join_at, new Date(Date.parse(scheduledAt) - 60000).toISOString());
  assert.equal(providerCreates[0].metadata.owner_id, alice);
  assert.equal(providerCreates[0].metadata.workspace_id, ws);
  const saved = rows.interview_sessions[0];
  saved.brief = "Manually curated focus stays intact";
  await scheduler.scheduleAutomaticNotetakersForUpcomingIds([eventA]);
  assert.equal(providerCreates.length, 1, "Repeated calendar notifications reuse the reservation");
  assert.equal(saved.brief, "Manually curated focus stays intact");

  scope = { workspaceId: ws, userId: bob };
  await scheduler.scheduleAutomaticNotetakersForUpcomingIds([eventB]);
  assert.equal(providerCreates.length, 2);
  assert.equal(providerCreates[1].metadata.owner_id, bob);
  assert.notEqual(rows.meet_capture_subscribers[0].session_id, rows.meet_capture_subscribers[1].session_id);

  rows.workspace_members[1].status = "suspended";
  const start = () => route.POST(new Request("https://crm.test/api/meet/start", { method: "POST", body: JSON.stringify({
    meetingUrl: rows.upcoming_calls[1].meeting_url, sessionId: rows.meet_capture_subscribers[1].session_id, upcomingId: eventB, autoStart: true,
  }) }));
  assert.equal((await start()).status, 403, "Suspended members cannot reattach even to an existing reservation");
  scope = { workspaceId: "another-workspace", userId: alice };
  assert.equal((await start()).status, 403, "Membership from a different workspace is not authority");
  assert.equal(providerCreates.length, 2);

  scope = { workspaceId: ws, userId: alice }; browser = true;
  const manualStart = () => route.POST(new Request("https://crm.test/api/meet/start", { method: "POST", body: JSON.stringify({
    meetingUrl: rows.upcoming_calls[0].meeting_url, sessionId: rows.meet_capture_subscribers[0].session_id, upcomingId: eventA,
  }) }));
  const manualResponses = await Promise.all([manualStart(), manualStart()]);
  assert.deepEqual(manualResponses.map((response) => response.status).sort(), [200, 409], "Only one concurrent early start can own the provider handover");
  assert.equal(providerCreates.length, 3);
  assert.deepEqual(providerDeletes, ["bot-1"]);
  assert.equal("join_at" in providerCreates[2], false, "Manual start creates an on-demand bot without waiting for calendar time");
  assert.equal(rows.meet_bots[0].bot_id, "bot-3");
  assert.equal(rows.meet_bots[0].scheduled_join_at, null);
  assert.equal(rows.meet_bots[0].manual_dispatch_claimed_at, null);
  assert.equal(rows.meet_capture_subscribers[0].status, "active");
  browser = false;
  const postStartSync = await scheduler.scheduleAutomaticNotetakersForUpcomingIds([eventA]);
  assert.equal(postStartSync.started, 1);
  assert.equal(providerCreates.length, 3, "Calendar resync reuses the immediate bot already running for this call");

  // If Recall has already begun launching the reservation, DELETE is rejected.
  // Reuse that exact bot instead of interrupting it or creating a duplicate.
  scope = { workspaceId: ws, userId: bob }; browser = true;
  rows.workspace_members[1].status = "active";
  deleteStatusByBot.set("bot-2", 405);
  const alreadyStarted = await route.POST(new Request("https://crm.test/api/meet/start", { method: "POST", body: JSON.stringify({
    meetingUrl: rows.upcoming_calls[1].meeting_url, sessionId: rows.meet_capture_subscribers[1].session_id, upcomingId: eventB,
  }) }));
  assert.equal(alreadyStarted.status, 200);
  assert.equal((await alreadyStarted.json()).botId, "bot-2");
  assert.equal(providerCreates.length, 3, "A provider bot already launching is never duplicated");
  assert.equal(rows.meet_capture_subscribers[1].status, "active");
  deleteStatusByBot.delete("bot-2");

  // Both users already share an old five-minute reservation. A detach/recreate
  // loop would reattach to that same old bot forever while another subscriber
  // remains. Exercise the real provider PATCH and scoped compare-and-set.
  browser = false;
  scope = { workspaceId: ws, userId: alice };
  rows.workspace_members[1].status = "active";
  rows.upcoming_calls.forEach((call) => { call.source = "google"; call.external_id = "same-provider-occurrence"; });
  const { meetingInstanceKey } = load("lib/shared-meet-capture.ts", dependencies);
  const capture = rows.meet_bots[0];
  capture.meeting_instance_key = meetingInstanceKey(rows.upcoming_calls[0].meeting_url, scheduledAt);
  const oldTime = new Date(Date.parse(scheduledAt) - 300000).toISOString();
  capture.scheduled_join_at = oldTime;
  capture.scheduled_meeting_url = rows.upcoming_calls[0].meeting_url;
  rows.meet_bots[1].status = "left";
  rows.meet_capture_subscribers[1].capture_id = capture.id;
  const sessions = rows.meet_capture_subscribers.map((row) => row.session_id);
  const sharedStart = (id, room) => route.POST(new Request("https://crm.test/api/meet/start", { method: "POST", body: JSON.stringify({
    meetingUrl: rows.upcoming_calls[0].meeting_url, sessionId: room, upcomingId: id, autoStart: true,
  }) }));
  assert.equal((await sharedStart(eventA, sessions[0])).status, 200);
  assert.equal(providerEdits.length, 1);
  assert.equal(capture.scheduled_join_at, new Date(Date.parse(scheduledAt) - 60000).toISOString());
  assert.deepEqual(rows.meet_capture_subscribers.map((row) => row.session_id), sessions, "Both private rooms survive retiming");
  assert.ok(rows.meet_capture_subscribers.every((row) => row.capture_id === capture.id));
  scope = { workspaceId: ws, userId: bob };
  assert.equal((await sharedStart(eventB, sessions[1])).status, 200);
  assert.equal(providerEdits.length, 1, "Second attendee reuses the confirmed timing without another PATCH");
  capture.scheduled_join_at = oldTime;
  editStatus = 400;
  assert.equal((await sharedStart(eventB, sessions[1])).status, 200, "A provider-locked reservation is kept, not cancelled or duplicated");
  assert.equal(capture.scheduled_join_at, oldTime, "Do not falsely claim an unconfirmed provider change");
  editStatus = 503;
  const savedError = console.error;
  try {
    console.error = () => {};
    assert.equal((await sharedStart(eventB, sessions[1])).status, 500, "Unconfirmed provider failures retain the reservation for retry");
  } finally { console.error = savedError; }
  assert.equal(providerCreates.length, 3, "Shared retiming never creates another bot");
  assert.equal(capture.scheduled_join_at, oldTime);
  editStatus = 200;
  rows.meet_capture_subscribers.splice(1, 1);
  assert.equal((await sharedStart(eventB, sessions[1])).status, 200, "An attendee without an existing subscription can align the same verified occurrence");
  assert.equal(capture.scheduled_join_at, new Date(Date.parse(scheduledAt) - 60000).toISOString());
  assert.equal(rows.meet_capture_subscribers.length, 2);
  assert.deepEqual(rows.meet_capture_subscribers.map((row) => row.session_id), sessions);
  assert.equal(providerCreates.length, 3);
  const botUpdates = queries.filter((q) => q.table === "meet_bots" && q.operation === "update");
  assert.ok(botUpdates.every((q) =>
    ["workspace_id", "id"].every((key) => q.filters.some(([field]) => field === key))));
  assert.ok(botUpdates.some((q) =>
    ["workspace_id", "id", "bot_id", "meeting_instance_key", "status", "scheduled_join_at"].every((key) => q.filters.some(([field]) => field === key))));
  assert.ok(botUpdates.some((q) =>
    ["workspace_id", "id", "bot_id", "status", "manual_dispatch_claimed_at"].every((key) => q.filters.some(([field]) => field === key))));
  assert.ok(queries.filter((q) => q.table === "workspace_members").every((q) =>
    ["workspace_id", "user_id", "status"].every((key) => q.filters.some(([field]) => field === key))));
  // A late manual start must also launch immediately when the old scheduled bot
  // is no longer present at Recall.
  rows.meet_bots.forEach((row) => { row.status = "left"; });
  rows.meet_capture_subscribers.forEach((row) => { row.status = "ended"; });
  const eventC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const lateScheduledAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const lateSession = "lc-late-manual-start";
  rows.upcoming_calls.push({
    id: eventC, owner_id: alice, workspace_id: ws, scheduled_at: lateScheduledAt,
    meeting_url: "https://meet.google.com/late-call-now", source: "manual", completed_at: null,
    title: "Late call", prep: null, visibility: "private",
  });
  rows.meet_bots.push({
    id: "late-capture", bot_id: "late-provider", bot_name: "Notetaker Alice",
    session_id: lateSession, owner_id: alice, workspace_id: ws, meeting_instance_key: null,
    source_upcoming_id: eventC, scheduled_join_at: new Date(Date.parse(lateScheduledAt) - 60000).toISOString(),
    scheduled_meeting_url: "https://meet.google.com/late-call-now", manual_dispatch_claimed_at: null,
    status: "active", created_at: new Date().toISOString(), ended_at: null,
  });
  rows.meet_capture_subscribers.push({
    id: "late-subscriber", capture_id: "late-capture", workspace_id: ws, owner_id: alice,
    session_id: lateSession, upcoming_id: eventC, status: "scheduled", visibility: "private",
  });
  scope = { workspaceId: ws, userId: alice }; browser = true;
  deleteStatusByBot.set("late-provider", 404);
  const lateManual = await route.POST(new Request("https://crm.test/api/meet/start", { method: "POST", body: JSON.stringify({
    meetingUrl: "https://meet.google.com/late-call-now", sessionId: lateSession, upcomingId: eventC,
  }) }));
  const lateData = await lateManual.json();
  assert.equal(lateManual.status, 200);
  assert.equal(lateData.status, "joining");
  assert.equal(providerDeletes.at(-1), "late-provider");
  assert.equal(providerCreates.length, 4);
  assert.equal("join_at" in providerCreates.at(-1), false);
  assert.equal(rows.meet_bots.find((row) => row.id === "late-capture").bot_id, "bot-4");
  assert.equal(rows.meet_capture_subscribers.find((row) => row.id === "late-subscriber").status, "active");

  console.log("Background dispatch, early and late immediate manual launch, one-minute timing, shared reservation retiming, locked-provider safety, manual focus preservation and two-user isolation passed");
} finally {
  globalThis.fetch = savedFetch;
  if (env.key === undefined) delete process.env.RECALL_API_KEY; else process.env.RECALL_API_KEY = env.key;
  if (env.region === undefined) delete process.env.RECALL_REGION; else process.env.RECALL_REGION = env.region;
}
