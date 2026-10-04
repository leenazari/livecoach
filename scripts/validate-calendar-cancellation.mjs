import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const now = Date.now();
const at = minutes => new Date(now + minutes * 60000).toISOString();
const rows = {
  meet_bots: [
    { id: "shared", bot_id: "shared-provider", owner_id: "alice", source_upcoming_id: "alice-call", scheduled_join_at: at(60) },
    { id: "waiting", bot_id: "waiting-provider", owner_id: "alice", source_upcoming_id: "waiting-call", scheduled_join_at: at(-2) },
    { id: "early", bot_id: "early-provider", owner_id: "alice", source_upcoming_id: "early-call", scheduled_join_at: at(-3) },
    { id: "ongoing", bot_id: "ongoing-provider", owner_id: "alice", source_upcoming_id: "ongoing-call", scheduled_join_at: at(-8) },
  ].map(row => ({ ...row, status: "active", workspace_id: "workspace-a" })),
  meet_capture_subscribers: [
    { id: "alice-shared", capture_id: "shared", owner_id: "alice", upcoming_id: "alice-call", session_id: "a-shared" },
    { id: "bob-shared", capture_id: "shared", owner_id: "bob", upcoming_id: "bob-call", session_id: "b-shared" },
    { id: "waiting-sub", capture_id: "waiting", owner_id: "alice", upcoming_id: "waiting-call", session_id: "a-waiting" },
    { id: "early-sub", capture_id: "early", owner_id: "alice", upcoming_id: "early-call", session_id: "a-early" },
    { id: "ongoing-sub", capture_id: "ongoing", owner_id: "alice", upcoming_id: "ongoing-call", session_id: "a-ongoing" },
  ].map(row => ({ ...row, workspace_id: "workspace-a", status: "scheduled" })),
  meet_utterances: [{ id: 1, workspace_id: "workspace-a", bot_id: "early-provider", text: "The meeting started early" }],
  meet_stream_tokens: [], meet_capture_access: [],
};
const calls = [];
const db = { from(table) {
  const predicates = []; let patch, count = false, limit = Infinity;
  const builder = {
    select(_fields, options) { count = options?.count === "exact"; return this; },
    update(value) { patch = value; return this; },
    eq(k,v) { predicates.push(r => r[k] === v); return this; },
    gt(k,v) { predicates.push(r => r[k] > v); return this; },
    in(k,v) { predicates.push(r => v.includes(r[k])); return this; },
    is(k,v) { predicates.push(r => r[k] === v); return this; },
    limit(value) { limit = value; return this; },
    then(resolve) {
      const data = (rows[table] || []).filter(row => predicates.every(p => p(row))).slice(0, limit);
      if (patch) data.forEach(row => Object.assign(row, patch));
      return resolve({ data, count: count ? data.length : null, error: null });
    },
  };
  return builder;
}};
const exports = {};
const source = readFileSync(new URL("../lib/recall-scheduled-bot.ts", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
  exports, Date, AbortSignal,
  process: { env: { RECALL_API_KEY: "test-only", RECALL_REGION: "test-only" } },
  fetch: async (url, init) => { calls.push([url, init.method]); return new Response(null, { status: 204 }); },
  require(name) {
    if (name === "server-only") return {};
    if (name.endsWith("supabase")) return { supabaseService: db };
    if (name.endsWith("precall-schedule")) return { PRECALL_LEAD_MS: 300000 };
    throw new Error(name);
  },
});
const cancel = (ownerId, upcomingIds, workspaceId = "workspace-a") => exports.cancelScheduledNotetakers({ workspaceId, ownerId, upcomingIds });
assert.equal((await cancel("alice", ["alice-call"])).cancelled, 0);
assert.equal(calls.length, 0, "One participant cannot cancel another participant's shared capture");
assert.equal(rows.meet_capture_subscribers.find(r => r.id === "alice-shared").status, "ended");
assert.equal(rows.meet_capture_subscribers.find(r => r.id === "bob-shared").status, "scheduled");
assert.equal((await cancel("bob", ["bob-call"])).cancelled, 1);
assert.equal(calls.length, 1, "Last subscriber cancels the provider reservation");
assert.equal((await cancel("alice", ["waiting-call"])).cancelled, 1, "Cancel during the five-minute arrival window withdraws an idle bot");
assert.equal((await cancel("alice", ["early-call", "ongoing-call"])).cancelled, 0, "Early speech and ongoing calls are protected");
assert.equal((await cancel("alice", ["waiting-call"])).cancelled, 0, "Cancellation replay creates no new provider operation");
assert.equal((await cancel("alice", ["early-call"], "workspace-b")).cancelled, 0);
console.log("Calendar cancellation timing, active speech protection, replay and shared-account isolation passed");
