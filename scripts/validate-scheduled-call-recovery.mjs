import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../lib/scheduled-call-recovery.ts", import.meta.url), "utf8");
const now = Date.parse("2026-10-05T11:00:00Z");
const stamp = (minutes) => new Date(now - minutes * 60000).toISOString();
let scope = { workspaceId: "workspace-a", userId: "alice" };
let deny = false;
const queries = [];
const rows = {
  meet_capture_subscribers: [
    { workspace_id: "workspace-a", owner_id: "alice", session_id: "alice-room", capture_id: "shared" },
    { workspace_id: "workspace-a", owner_id: "bob", session_id: "bob-private", capture_id: "private" },
    { workspace_id: "workspace-b", owner_id: "outsider", session_id: "outside", capture_id: "outside" },
  ],
  meet_bots: [
    { id: "shared", workspace_id: "workspace-a", owner_id: "bob", bot_id: "shared-bot", status: "active", scheduled_join_at: stamp(90) },
    { id: "private", workspace_id: "workspace-a", owner_id: "bob", bot_id: "private-bot", status: "active", scheduled_join_at: stamp(90) },
  ],
  interview_sessions: [
    { workspace_id: "workspace-a", owner_id: "alice", session_id: "alice-room", transcript: null, ended_at: null },
    { workspace_id: "workspace-a", owner_id: "bob", session_id: "bob-private", transcript: null, ended_at: null },
  ],
  meet_utterances: [
    { id: 1, workspace_id: "workspace-a", bot_id: "shared-bot", speaker: "Buyer", text: "Discussed the agreed plan. ".repeat(30), created_at: stamp(20) },
    { id: 2, workspace_id: "workspace-a", bot_id: "private-bot", speaker: "Private", text: "Secret investment discussion. ".repeat(30), created_at: stamp(20) },
  ],
};
const db = { from(table) {
  const predicates = [];
  let patch = null, single = false, limit = Infinity, start = 0, end = Infinity;
  const query = { table, filters: [], writes: null };
  queries.push(query);
  const builder = {
    select() { return this; },
    update(value) { patch = value; query.writes = value; return this; },
    eq(key, value) { query.filters.push([key, value]); predicates.push((row) => row[key] === value); return this; },
    in(key, values) { predicates.push((row) => values.includes(row[key])); return this; },
    gte(key, value) { predicates.push((row) => row[key] >= value); return this; },
    is(key, value) { predicates.push((row) => row[key] === value); return this; },
    order() { return this; },
    limit(value) { limit = value; return this; },
    range(a, b) { start = a; end = b + 1; return this; },
    maybeSingle() { single = true; return this; },
    then(resolve, reject) {
      try {
        let data = (rows[table] || []).filter((row) => predicates.every((test) => test(row))).slice(start, end).slice(0, limit);
        if (patch) data.forEach((row) => Object.assign(row, patch));
        return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject);
      } catch (error) { return Promise.reject(error).then(resolve, reject); }
    },
  };
  return builder;
}};
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
  exports: module.exports, module,
  require(name) {
    if (name === "server-only") return {};
    if (name.endsWith("record-scope")) return { resolveRecordScope: async () => { if (deny) throw new Error("Inactive or unverified account"); return scope; } };
    if (name.endsWith("supabase")) return { supabaseService: db };
    throw new Error(`Unexpected dependency ${name}`);
  },
});
const { recoverScheduledCallInputs: recover } = module.exports;

const alice = await recover(new Set(), () => true, now);
assert.equal(alice.recovered.length, 1);
assert.equal(alice.recovered[0].session_id, "alice-room");
assert.match(alice.recovered[0].transcript, /^Buyer:/);
assert.doesNotMatch(alice.recovered[0].transcript, /Secret/);
assert.equal(rows.interview_sessions[0].transcript, null, "Raw speech is not duplicated into another store");
assert.ok(queries.every((query) => query.filters.some(([key, value]) => key === "workspace_id" && value === scope.workspaceId)));
assert.ok(queries.filter((query) => ["interview_sessions", "meet_capture_subscribers"].includes(query.table)).every((query) => query.filters.some(([key, value]) => key === "owner_id" && value === scope.userId)));

queries.length = 0;
assert.equal((await recover(new Set(["alice-room"]), () => true, now)).recovered.length, 0);
assert.equal(queries.some((query) => query.table === "meet_utterances"), false, "Summarised calls are not reread");
assert.equal((await recover(new Set(), () => false, now)).recovered.length, 0, "Retry backoff is respected");

rows.meet_utterances[0].created_at = stamp(2);
const live = await recover(new Set(), () => true, now);
assert.equal(live.recovered.length, 0, "Recent canonical speech prevents mid-call summaries");
assert.equal(live.scheduledSessionIds[0], "alice-room", "Old browser notes must also be excluded for this live capture");

scope = { workspaceId: "workspace-a", userId: "bob" };
const bob = await recover(new Set(), () => true, now);
assert.equal(bob.recovered[0].session_id, "bob-private");
assert.match(bob.recovered[0].transcript, /Secret/);
scope = { workspaceId: "workspace-b", userId: "alice" };
assert.equal((await recover(new Set(), () => true, now)).recovered.length, 0);
deny = true;
await assert.rejects(() => recover(new Set(), () => true, now), /Inactive or unverified/);
console.log("Scheduled capture recovery, replay protection and two-user isolation passed");
