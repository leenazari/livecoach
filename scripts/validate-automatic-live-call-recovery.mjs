import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { currentRecallBotState } from "../lib/recall-bot-status.ts";
import { validMeetingUrl } from "../lib/meeting-url.ts";

const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function load(file, dependency) {
  const module = { exports: {} };
  const source = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  new Function("require", "module", "exports", source)(dependency, module, module.exports);
  return module.exports;
}
const { validUuid } = load("lib/shared-meet-capture.ts", (name) =>
  name.endsWith("meeting-url") ? { validMeetingUrl } : require(name)
);
const { validMeetSessionId } = load("lib/transcriber.ts", (name) => {
  if (name === "server-only" || name.endsWith("supabase")) return {};
  if (name.endsWith("meeting-url")) return { validMeetingUrl };
  return require(name);
});
const eventA = "46482c8f-182c-46dc-9c25-46ea99fdeb81";
const eventB = "64883abe-8824-450a-a826-e1dbfa9e163f";
let scope = { userId: "lee", workspaceId: "workspace-a" };
let denied = false, conflict = false, providerCalls = 0;
const queries = [];
const rows = {
  meet_capture_subscribers: [
    { owner_id: "lee", workspace_id: "workspace-a", session_id: "lc-lee-room", upcoming_id: eventA, capture_id: "capture-a", status: "scheduled" },
    { owner_id: "kam", workspace_id: "workspace-a", session_id: "lc-kam-room", upcoming_id: eventB, capture_id: "capture-b", status: "scheduled" },
    { owner_id: "kam", workspace_id: "workspace-a", session_id: "lc-kam-shared", upcoming_id: eventA, capture_id: "capture-a", status: "scheduled" },
  ],
  meet_bots: [
    { id: "capture-a", workspace_id: "workspace-a", owner_id: "lee", bot_id: "bot-a", bot_name: "Lee's notetaker", status: "active", ended_at: null },
    { id: "capture-b", workspace_id: "workspace-a", owner_id: "kam", bot_id: "bot-b", bot_name: "Kam's notetaker", status: "active", ended_at: null },
  ],
  meet_stream_tokens: [],
};
const db = { from(table) {
  const predicates = [];
  const query = { table, filters: [], patch: null };
  queries.push(query);
  let single = false, limit = Infinity;
  return {
    select() { return this; }, order() { return this; },
    update(patch) { query.patch = patch; return this; },
    eq(key, value) { query.filters.push([key, value]); predicates.push((r) => r[key] === value); return this; },
    in(key, values) { predicates.push((r) => values.includes(r[key])); return this; },
    is(key, value) { predicates.push((r) => r[key] === value); return this; },
    limit(value) { limit = value; return this; },
    maybeSingle() { single = true; return this; },
    then(resolve, reject) {
      if (conflict && query.patch?.status === "active") return Promise.resolve({ data: null, error: { code: "23505" } }).then(resolve, reject);
      const found = rows[table].filter((r) => predicates.every((p) => p(r))).slice(0, limit);
      if (query.patch) found.forEach((r) => Object.assign(r, query.patch));
      return Promise.resolve({ data: single ? found[0] || null : found, error: null }).then(resolve, reject);
    },
  };
} };
let provider = { status_changes: [{ code: "in_call_recording", created_at: new Date().toISOString() }] };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  assert.equal(options?.method, undefined, "Provider calls must be reads only, never create/restart/leave");
  providerCalls++;
  return Response.json(provider);
};
const savedKey = process.env.RECALL_API_KEY, savedRegion = process.env.RECALL_REGION;
process.env.RECALL_API_KEY = "test-key";
process.env.RECALL_REGION = "test";
const route = load("app/api/meet/status/route.ts", (name) => {
  if (name === "next/server") return { NextResponse: { json: (body, options) => Response.json(body, options) } };
  if (name.endsWith("record-scope")) return { resolveRecordScope: async () => { if (denied) throw new Error("Verified active account required"); return scope; } };
  if (name.endsWith("supabase")) return { supabaseService: db };
  if (name.endsWith("shared-meet-capture")) return { validUuid };
  if (name.endsWith("transcriber")) return { validMeetSessionId };
  if (name.endsWith("recall-bot-status")) return { currentRecallBotState };
  throw new Error(`Unexpected dependency ${name}`);
});
const request = (session = "lc-lee-room", upcoming = eventA) => ({ nextUrl: new URL(`https://crm.test/api/meet/status?session=${session}${upcoming ? `&upcoming=${upcoming}` : ""}`) });
assert.equal((await route.GET(request())).status, 200);
assert.equal(rows.meet_capture_subscribers[0].status, "scheduled", "Reading status must not activate a viewer");
let response = await route.POST(request());
let data = await response.json();
assert.equal(response.status, 200);
assert.equal(data.botId, "bot-a");
assert.equal(data.sessionId, "lc-lee-room");
assert.equal(data.canResume, true);
assert.equal(rows.meet_capture_subscribers[0].status, "active");
assert.equal(rows.meet_capture_subscribers[1].status, "scheduled");
assert.equal(rows.meet_capture_subscribers[2].status, "scheduled", "Teammate activation is independent");
assert.equal((await route.POST(request())).status, 200, "Refresh is idempotent");
assert.ok(queries.every((q) => q.filters.some(([key, value]) => key === "workspace_id" && value === scope.workspaceId)));
assert.ok(queries.filter((q) => q.table === "meet_capture_subscribers").every((q) => q.filters.some(([key, value]) => key === "owner_id" && value === scope.userId)));

data = await (await route.POST(request("lc-old-browser"))).json();
assert.equal(data.sessionId, "lc-lee-room", "Return the existing private room rather than rewriting it");
assert.equal((await route.POST(request("lc-lee-room", eventB))).status, 409, "Conflicting call identity fails closed");
const callsBeforeIsolation = providerCalls;
assert.equal((await route.POST(request("lc-kam-room", eventB))).status, 404, "Another user's private call stays inaccessible");
scope = { userId: "lee", workspaceId: "workspace-b" };
assert.equal((await route.POST(request())).status, 404);
denied = true;
assert.equal((await route.POST(request())).status, 500);
assert.equal(providerCalls, callsBeforeIsolation, "Unauthorized lookups never query provider state");
denied = false;
scope = { userId: "kam", workspaceId: "workspace-a" };
assert.equal((await (await route.POST(request("lc-kam-shared"))).json()).sessionId, "lc-kam-shared");
assert.equal(rows.meet_capture_subscribers[2].status, "active", "Explicit shared subscriber keeps its own coaching room");

scope = { userId: "lee", workspaceId: "workspace-a" };
rows.meet_capture_subscribers[0].status = "scheduled";
provider = { join_at: new Date(Date.now() + 3600000).toISOString(), status_changes: [] };
data = await (await route.POST(request())).json();
assert.equal(data.canResume, false);
assert.equal(data.state.phase, "scheduled");
assert.equal(rows.meet_capture_subscribers[0].status, "scheduled", "Future prep does not occupy the live slot");
provider = { status_changes: [{ code: "in_call_recording", created_at: new Date().toISOString() }] };
conflict = true;
assert.equal((await route.POST(request())).status, 409, "Another active room produces a clear conflict, not a second bot");
conflict = false;
provider = { status_changes: [{ code: "call_ended", created_at: new Date().toISOString() }] };
data = await (await route.POST(request())).json();
assert.equal(data.canResume, false);
assert.equal(rows.meet_capture_subscribers[0].status, "ended");
assert.equal(rows.meet_bots[0].status, "left");
assert.equal(data.state.phase, "ended");
if (savedKey === undefined) delete process.env.RECALL_API_KEY; else process.env.RECALL_API_KEY = savedKey;
if (savedRegion === undefined) delete process.env.RECALL_REGION; else process.env.RECALL_REGION = savedRegion;

// Exercise the real React component with the existing provider response,
// canonical backfill and live socket. No browser or external service is used.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://crm.test/call" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const sockets = [], calls = [], recovered = [], transcript = [];
const savedUtterances = [{ speaker: "Lee Nazari", text: "Good morning, everyone.", ts: "2026-10-05T09:00:01Z" }, { speaker: "Buyer", text: "Let us discuss the product release plan.", ts: "2026-10-05T09:00:02Z" }];
let turns = 0, phase = "recording", available = true, canonicalRoom = "lc-lee-room";
let deferBackfill = null;
globalThis.WebSocket = class {
  constructor(url) { this.url = url; sockets.push(this); }
  close() {}
};
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  if (String(url).startsWith("/api/meet/status")) return Response.json(available ? {
    sessionId: canonicalRoom, botId: "bot-a", botName: "Lee's notetaker", canResume: phase === "recording",
    state: { phase, terminal: phase === "ended", message: phase, recording: phase === "recording", joined: phase === "recording" },
  } : { error: "No notetaker request exists" }, { status: available ? 200 : 404 });
  if (url === "/api/meet/access") return Response.json({ token: "test", workerWs: "wss://worker.test", expiresAt: new Date(Date.now() + 3600000).toISOString(), coachHints: ["Lee Nazari"], teamHints: ["Kam"], botName: "Lee's notetaker" });
  if (String(url).startsWith("/api/meet/backfill")) {
    if (deferBackfill) await deferBackfill;
    return Response.json({ utterances: savedUtterances });
  }
  throw new Error(`Unexpected cost-bearing or unrelated request ${url}`);
};
const MeetStage = load("components/MeetStage.tsx", (name) => {
  if (name.endsWith("call-silence")) return { CALL_SILENCE_WARNING_MS: 60000, callSilenceRemainingMs: () => 300000 };
  return require(name);
}).default;
const root = createRoot(document.getElementById("root"));
let key = 0;
const props = () => ({ key: ++key, room: "lc-lee-room", upcomingId: eventA, meetingUrl: "https://meet.google.com/abc-defg-hij", onFinalTranscript: (...args) => transcript.push(args), onCandidateTurnEnd: () => turns++, onSessionRecovered: (...args) => recovered.push(args), onSilenceTimeout: () => { throw new Error("Unexpected silence stop"); } });
const render = async (overrides = {}) => act(async () => { root.render(React.createElement(MeetStage, { ...props(), ...overrides })); });
await render();
assert.match(document.body.textContent, /On air/i);
assert.deepEqual(recovered.at(-1), ["lc-lee-room", true]);
assert.equal(transcript.length, 2);
assert.equal(transcript[0][0], "interviewer", "Saved transcript receives this account's speaker labels");
assert.equal(transcript[1][0], "candidate");
assert.equal(transcript[0][3], true, "Historical speech cannot trigger a new manual start");
await act(async () => { sockets.at(-1).onopen(); });
assert.equal(transcript.length, 2, "Mount and socket-open backfills do not duplicate speech");
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1650)); });
assert.equal(turns, 1, "Recovered live context starts one coaching checkpoint");
await act(async () => {
  const utterance = { speaker: "Buyer", text: "And what would the next steps be?", ts: "2026-10-05T09:00:03Z" };
  savedUtterances.push({ ...utterance, ts: "2026-10-05T09:00:03+00:00" });
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: "utterance", ...utterance }) });
});
assert.equal(transcript.length, 3, "New live speech feeds the existing coaching callback");
assert.equal(transcript[2][3], undefined);
await act(async () => sockets.at(-1).onopen());
assert.equal(transcript.length, 3, "Canonical recovery deduplicates speech already delivered by the socket");
assert.equal(calls.some((c) => c.url === "/api/meet/start"), false, "Opening a running automatic call never sends another bot");

phase = "ended";
recovered.length = 0;
await render();
assert.match(document.body.textContent, /Ended/);
assert.equal(recovered.length, 0, "Old transcript never turns an ended call live again");
phase = "scheduled";
await render();
assert.match(document.body.textContent, /Scheduled/);
assert.equal(recovered.length, 0, "Future reservation remains prep, not live");

phase = "recording";
canonicalRoom = "lc-old-saved-room";
const socketsBeforeFallback = sockets.length;
await render();
assert.deepEqual(recovered.at(-1), ["lc-old-saved-room", false]);
assert.equal(sockets.length, socketsBeforeFallback, "Room recovery precedes opening a transcript socket");

canonicalRoom = "lc-lee-room";
available = false;
await render();
assert.match(document.body.textContent, /Send bot/);
assert.equal(document.querySelector("button").disabled, false, "Manual send remains available when no reservation exists");

available = true;
let release;
deferBackfill = new Promise((resolve) => { release = resolve; });
await render();
const beforeUnmount = transcript.length;
await act(async () => root.unmount());
await act(async () => release());
assert.equal(transcript.length, beforeUnmount, "A stale backfill cannot write into a different call after navigation");
assert.equal(calls.some((c) => c.url === "/api/meet/start" || c.url === "/api/meet/stop"), false);
globalThis.fetch = originalFetch;
dom.window.close();

const page = read("app/call/page.tsx");
assert.match(page, /goLiveRef\.current\(false\)/);
assert.match(page, /if \(!requestBot && source === "meet"\) return;\s*persistSession\(\)/);
assert.match(page, /<MeetStage\s+key=\{room\}/);
assert.match(page, /onSessionRecovered=\{resumeExistingSession\}/);
const hydration = page.slice(page.indexOf('const { call } = await crmFetch'), page.indexOf('// FIRST-MEETING INTENT HELP'));
assert.ok(hydration.indexOf('setSource("meet")') < hydration.indexOf('await crmFetch<any>("/api/crm/email-pull"'), "Live meeting hookup must precede slow email/AI work");
console.log("Automatic call recovery, transcript and coaching hookup, no duplicate dispatch, future/ended safety and two-user isolation passed");
