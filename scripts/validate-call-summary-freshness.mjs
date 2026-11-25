import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { callTranscriptHash, callSummaryContentHash, callSummaryIsCurrent, summarySourceEvidence, revisedSummaryPackage } from "../lib/call-summary-freshness.ts";
import { scheduledCallSessionId } from "../lib/scheduled-call-session.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const before = "2026-11-20T16:08:00Z";
const after = "2026-11-25T16:51:00Z";
const transcript = "Buyer: The trial is agreed. I will send the student list.\nHost: I will prepare the practice invitations. ".repeat(7);
const session = { session_id: "lc-room", transcript, ended_at: after };
const old = { summary: { title: "No-show", userNotes: "Did not join" }, created_at: before };
const fresh = { summary: { sourceEvidence: summarySourceEvidence(session.session_id, transcript) }, created_at: after };
assert.equal(callSummaryIsCurrent(old, session), false);
assert.equal(callSummaryIsCurrent(fresh, session), true);
assert.equal(callSummaryIsCurrent(fresh, { ...session, transcript: `${transcript} Buyer: One more action.` }), false);
assert.equal(callSummaryIsCurrent(fresh, { ...session, session_id: "another-call" }), false);
assert.equal(callSummaryIsCurrent(fresh, null), false);
assert.equal(callSummaryIsCurrent({ ...old, created_at: after }, session), true, "Unchanged legacy calls are not needlessly reprocessed");
const history = revisedSummaryPackage({ ...old, cache_key: "old", post_call_package: { actionPreparation: { nextCallFocus: "Rebook" } } });
assert.equal(history.summaryRevisions[0].summary.title, "No-show");
assert.equal(history.actionPreparation, undefined, "Old actions cannot become the new action pack");
assert.equal(history.summaryRevisions[0].package.actionPreparation.nextCallFocus, "Rebook");
assert.equal(JSON.stringify(history).includes(transcript), false, "No raw transcript duplication");
const id = "15e31b03-e720-4b4f-81f3-06842c181ae8";
assert.notEqual(scheduledCallSessionId(id, before), scheduledCallSessionId(id, after));
assert.equal(scheduledCallSessionId(id, after), scheduledCallSessionId(id, "2026-11-25T17:51:00+01:00"));
assert.equal(scheduledCallSessionId(id, "invalid"), null);
assert.match(scheduledCallSessionId(id, after), /^lc-[a-z0-9-]{6,80}$/);
assert.equal(callSummaryContentHash({ title: "Agreed", nested: { b: 1, a: 2 } }), callSummaryContentHash({ nested: { a: 2, b: 1 }, title: "Agreed" }));
assert.notEqual(callSummaryContentHash({ title: "No-show" }), callSummaryContentHash({ title: "Agreed" }));

let scope = { userId: "alice", workspaceId: "workspace-a" };
let deny = false, failTable = null, failWrite = false, modelCalls = 0, preparations = 0;
let lateSpeech = false, failAfterSave = false;
let rows = {}, queries = [];
function reset() {
  scope = { userId: "alice", workspaceId: "workspace-a" };
  deny = false; failTable = null; failWrite = false; modelCalls = 0; preparations = 0; queries = [];
  lateSpeech = false; failAfterSave = false;
  rows = {
    interview_sessions: [
      { ...session, owner_id: "alice", workspace_id: "workspace-a", summary_attempts: 1, summary_last_try: before },
      { ...session, owner_id: "bob", workspace_id: "workspace-a", transcript: "Private investor discussion", summary_attempts: 0, summary_last_try: null },
      { ...session, owner_id: "alice", workspace_id: "workspace-b", transcript: "Another workspace", summary_attempts: 0, summary_last_try: null },
    ],
    interview_summaries: [
      { ...structuredClone(old), id: "alice-summary", session_id: session.session_id, owner_id: "alice", workspace_id: "workspace-a", cache_key: "old" },
      { id: "bob-summary", session_id: session.session_id, owner_id: "bob", workspace_id: "workspace-a", summary: { title: "Private investor outcome" }, created_at: after },
    ],
  };
}
const db = { from(table) {
  const predicates = [];
  let patch = null, insertion = null, single = false, limit = Infinity;
  const query = { table, filters: [] }; queries.push(query);
  const builder = {
    select() { return this; },
    update(value) { patch = value; return this; },
    insert(value) { insertion = value; return this; },
    eq(key, value) { query.filters.push([key, value]); predicates.push(r => r[key] === value); return this; },
    is(key, value) { query.filters.push([key, value]); predicates.push(r => (r[key] ?? null) === value); return this; },
    lt(key, value) { predicates.push(r => r[key] < value); return this; },
    contains(key, value) { predicates.push(r => Object.entries(value).every(([k,v]) => r[key]?.[k] === v)); return this; },
    order() { return this; },
    limit(n) { limit = n; return this; },
    maybeSingle() { single = true; return this; },
    single() { single = true; return this; },
    then(resolve, reject) {
      if (failTable === table || (failWrite && (patch || insertion))) return Promise.resolve({ data: null, error: { message: "simulated database failure" } }).then(resolve, reject);
      let found = (rows[table] || []).filter(r => predicates.every(test => test(r))).slice(0, limit);
      if (patch) found.forEach(r => Object.assign(r, structuredClone(patch)));
      if (insertion) { const r = { id: "new-summary", created_at: after, ...scope, ...insertion }; (rows[table] ||= []).push(r); found = [r]; }
      return Promise.resolve({ data: single ? structuredClone(found[0] || null) : structuredClone(found), error: null }).then(resolve, reject);
    },
  };
  return builder;
}};
const helpers = { callTranscriptHash, callSummaryContentHash, callSummaryIsCurrent, summarySourceEvidence, revisedSummaryPackage };
const load = (file, dependencies) => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports: module.exports, module, console, Date, Headers, Request, Response, URL, AbortController, setTimeout, clearTimeout, crypto: globalThis.crypto,
    require(name) {
      if (name === "server-only") return {};
      if (name === "next/server") return { NextRequest: Request, NextResponse: { json: (body, options) => Response.json(body, options) } };
      if (name.endsWith("call-summary-freshness")) return helpers;
      if (name.endsWith("supabase")) return { supabaseAdmin: db, supabaseService: db };
      if (name.endsWith("record-scope")) return { resolveRecordScope: async () => { if (deny) throw new Error("Inactive or unverified account"); return scope; } };
      if (dependencies[name]) return dependencies[name];
      if (["crypto", "node:crypto"].includes(name)) return require(name);
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return module.exports;
};
let failBuild = false;
const job = load("lib/call-summary-jobs.ts", {
  "@/lib/call-action-preparation": { prepareCallActions: async () => { preparations++; } },
  "@/lib/workstreams": { resolveCallScope: async () => ({ companyId: "company", workstream: null }) },
  "@/app/api/interview/summary/route": { POST: async req => {
    modelCalls++;
    const input = await req.json();
    if (failBuild) return Response.json({ error: "save failed" }, { status: 503 });
    const record = rows.interview_summaries.find(r => r.owner_id === scope.userId && r.workspace_id === scope.workspaceId);
    record.summary = { title: "Trial implementation", sourceEvidence: summarySourceEvidence(input.sessionId, input.transcript) };
    record.created_at = after;
    return Response.json({ summary: record.summary });
  } },
});
const request = new Request("https://livecoach.test/api/interview/session-end");
const payload = { sessionId: session.session_id, transcript, companyId: "company" };
reset();
let result = await job.runCallSummaryJob(request, payload);
assert.equal(result.landed, true); assert.equal(result.alreadyDone, false); assert.equal(modelCalls, 1);
assert.equal(rows.interview_summaries[1].summary.title, "Private investor outcome", "Another user's summary must not change");
result = await job.runCallSummaryJob(request, payload);
assert.equal(result.alreadyDone, true); assert.equal(modelCalls, 1, "An unchanged transcript is never paid for again");
for (const query of queries) {
  assert.ok(query.filters.some(([k,v]) => k === "workspace_id" && v === scope.workspaceId));
  assert.ok(query.filters.some(([k,v]) => k === "owner_id" && v === scope.userId));
}
reset(); failBuild = true;
result = await job.runCallSummaryJob(request, payload);
assert.equal(result.landed, false, "An old recap cannot be reported as successful after generation/save fails");
assert.equal(result.summary, null); assert.equal(preparations, 0); assert.match(result.error, /retry/i);
failBuild = false;
reset(); rows.interview_sessions[0].summary_last_try = new Date().toISOString();
result = await job.runCallSummaryJob(request, payload, { force: true });
assert.equal(result.inProgress, true); assert.equal(modelCalls, 0, "Retry clicks must not bypass an active generation lease");
reset(); failTable = "interview_summaries";
await assert.rejects(() => job.runCallSummaryJob(request, payload));
reset(); deny = true;
await assert.rejects(() => job.runCallSummaryJob(request, payload), /Inactive/);
reset(); scope = { userId: "outsider", workspaceId: "workspace-a" };
assert.equal((await job.runCallSummaryJob(request, payload)).landed, false); assert.equal(modelCalls, 0);

// Execute the actual save route, not just source assertions. The provider is
// stubbed, but account predicates, read-back and persistence are real code.
const route = load("app/api/interview/summary/route.ts", {
  "@/lib/openai": { OPENAI_MODEL_PRO: "test", OPENAI_MODEL_LIVE: "test", openai: { messages: { create: async () => {
    modelCalls++;
    if (lateSpeech) rows.interview_sessions[0].transcript += " Buyer: Another agreed action arrived during generation.";
    return { content: [{ type: "text", text: JSON.stringify({ title: "Agreed trial launch", recommendation: "Positive", overview: "The agreed trial is being prepared.", actions: [] }) }], usage: {} };
  } } } },
  "@/lib/speakers": { loadHostIdentity: async () => ({ name: "Alice" }), loadHostIdentityForUser: async () => ({ name: "Alice" }), buildSpeakerMap: () => new Map(), canonicalName: (_,n) => n },
  "@/lib/workspace": { workspaceContextBlock: async () => "", getLessonsBlock: async () => "" },
  "@/lib/costs": { estimateCost: () => ({ totalGBP: 0 }) },
  "@/lib/commercial-memory": { getCommercialMemory: async () => null },
  "@/lib/opportunity-signals": { enqueueOpportunitySignal: async () => null },
  "@/lib/calls": { completeUpcomingForCall: async () => { if (failAfterSave) throw new Error("simulated follow-on save failure"); } },
  "@/lib/roster": { extractAttendees: () => [], matchByRoster: () => null },
  "@/lib/workstreams": { resolveCallScope: async () => ({ companyId: "company", workstream: null }) },
  "@/lib/request-scope": { isVerifiedServiceRequest: () => true },
  "@/lib/call-summary-retry": { withTransientSummaryRetry: async fn => fn() },
  "@/lib/call-summary-actions": { normalizeCallSummaryActions: a => a },
  "@/lib/shared-call-access": { loadSharedCallAccess: async () => null },
});
const routeRequest = () => new Request("https://livecoach.test/api/interview/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
reset();
let response = await route.POST(routeRequest());
assert.equal(response.status, 200);
assert.equal(rows.interview_summaries.length, 2, "Rebuild updates the same record, no duplicate current recap");
assert.equal(rows.interview_summaries[0].id, "alice-summary");
assert.equal(rows.interview_summaries[0].summary.title, "Agreed trial launch");
assert.equal(rows.interview_summaries[0].post_call_package.summaryRevisions[0].summary.title, "No-show");
assert.equal(rows.interview_summaries[0].summary.userNotes, undefined, "The old no-show note cannot poison the new conversation");
response = await route.POST(routeRequest());
assert.equal((await response.json()).cached, true); assert.equal(modelCalls, 1);
reset(); failWrite = true;
response = await route.POST(routeRequest());
assert.equal(response.status, 503, "A failed persistence must never return a successful saved summary");
assert.equal(rows.interview_summaries[0].summary.title, "No-show", "The previous record survives a failed replacement");
reset(); lateSpeech = true;
response = await route.POST(routeRequest());
assert.equal(response.status, 409, "New speech during generation cannot publish an obsolete recap");
assert.equal(rows.interview_summaries[0].summary.title, "No-show");
reset(); failAfterSave = true;
response = await route.POST(routeRequest());
assert.equal(response.status, 200);
const partialSave = await response.json();
assert.equal(partialSave.saved, true); assert.match(partialSave.warning, /summary is saved/);
assert.equal(rows.interview_summaries[0].summary.title, "Agreed trial launch");
reset(); scope = { userId: "outsider", workspaceId: "workspace-b" };
assert.equal((await route.POST(routeRequest())).status, 404); assert.equal(modelCalls, 0);

for (const file of ["app/api/interview/retry-summary/route.ts", "app/api/interview/summary-status/route.ts", "app/api/interview/backfill-scorecards/route.ts"]) {
  assert.match(read(file), /callSummaryIsCurrent/);
}
const prompt = read("app/api/interview/summary/route.ts");
assert.match(prompt, /agreed trial being configured is implementation progress/);
assert.match(prompt, /no minimum/);
assert.doesNotMatch(prompt, /3-6 items in strengths\/concerns/);
assert.match(read("app/call/page.tsx"), /scheduledCallSessionId\(upcoming, call.scheduled_at\)/);
assert.match(read("lib/automatic-precall.ts"), /scheduledCallSessionId\(call.id, call.scheduled_at\)/);
assert.match(read("app/api/meet/status/route.ts"), /That notetaker belongs to the earlier meeting time/);
assert.match(prompt, /sourceRecordId: `\$\{savedCall.id\}:\$\{callSummaryContentHash\(summary\)\}`/);

// Derived compact memory must change when the same recap ID and end time are
// corrected. This executes the real reader, not a second summary generator.
const memory = load("lib/commercial-memory.ts", {
  "@/lib/workstreams": { getWorkstreamScope: async () => null },
  "@/lib/opportunity-fields": { defaultOutlookQuestions: () => [] },
});
reset();
rows.companies = [{ id: "company", name: "Trial college", profile: {} }];
rows.interview_summaries = [{ id: "same-recap", company_id: "company", created_at: after, summary: { title: "No-show", overview: "Did not join" } }];
const firstMemory = await memory.getCommercialMemory("company");
assert.equal(firstMemory.lastCall.headline, "No-show");
rows.interview_summaries[0].summary = { title: "Agreed trial", overview: "Prepare the student invitations" };
const nextMemory = await memory.getCommercialMemory("company");
assert.notEqual(nextMemory.sourceHash, firstMemory.sourceHash);
assert.equal(nextMemory.lastCall.headline, "Agreed trial");
assert.equal((await memory.getCommercialMemory("company")).sourceHash, nextMemory.sourceHash);
assert.equal(modelCalls, 0);

// Changed recaps produce revision-specific evidence receipts. Superseded
// receipts cannot overwrite current intent, including during an AI request.
let changeDuringAssessment = false;
const signals = load("lib/opportunity-signals.ts", {
  "@/lib/openai": { OPENAI_MODEL_LIVE: "test", openai: { messages: { create: async () => {
    modelCalls++;
    if (changeDuringAssessment) rows.interview_summaries[0].summary = { title: "Newer correction" };
    return { content: "assessment", usage: {} };
  } } } },
  "@/lib/usage": { logModelUsage: async () => {} },
  "@/lib/commercial-memory": { getCommercialMemory: async () => null },
  "@/lib/outreach": { modelText: () => "assessment", parseObject: () => ({ material: true, outlook: "likely", confidence: 80, reasons: ["Trial agreed"], questions: [], dealIntent: "Deliver the agreed trial", rationale: "Current evidence" }) },
  "@/lib/opportunity-fields": { CONTACT_METHODS: ["video_call"], WIN_OUTLOOKS: ["likely"], cleanStringList: value => value || [], defaultOutlookQuestions: () => [] },
  "@/lib/request-scope": { getRequestScope: () => scope },
});
function signalFixture() {
  reset(); changeDuringAssessment = false;
  rows.interview_summaries[0] = { ...rows.interview_summaries[0], company_id: "company", summary: { title: "Agreed trial" }, created_at: after };
  rows.opportunities = [{ id: "opportunity", company_id: "company", owner_id: "alice", workspace_id: "workspace-a", status: "open", deal_intent: "Old intent", win_outlook_override: false, deal_intent_override: false }];
  rows.opportunity_signal_receipts = [{ id: "receipt", company_id: "company", owner_id: "alice", workspace_id: "workspace-a", opportunity_id: "opportunity", status: "queued", attempts: 0, source_record_type: "call_summary", source_channel: "video_call", occurred_at: after, source_record_id: `alice-summary:${callSummaryContentHash(rows.interview_summaries[0].summary)}` }];
}
signalFixture();
assert.equal((await signals.processQueuedOpportunitySignals()).complete, 1);
assert.equal(rows.opportunities[0].deal_intent, "Deliver the agreed trial");
assert.equal((await signals.processQueuedOpportunitySignals()).processed, 0); assert.equal(modelCalls, 1);
signalFixture(); rows.opportunity_signal_receipts[0].source_record_id = "alice-summary"; rows.opportunity_signal_receipts[0].occurred_at = before;
assert.equal((await signals.processQueuedOpportunitySignals()).ignored, 1); assert.equal(modelCalls, 0);
assert.equal(rows.opportunities[0].deal_intent, "Old intent");
signalFixture(); changeDuringAssessment = true;
assert.equal((await signals.processQueuedOpportunitySignals()).ignored, 1); assert.equal(modelCalls, 1);
assert.equal(rows.opportunities[0].deal_intent, "Old intent");
signalFixture(); rows.opportunity_signal_receipts[0].workspace_id = "workspace-b";
assert.equal((await signals.processQueuedOpportunitySignals()).ignored, 1); assert.equal(modelCalls, 0);
signalFixture(); failTable = "interview_summaries";
assert.equal((await signals.processQueuedOpportunitySignals()).failed, 1); assert.equal(modelCalls, 0);
console.log("Summary freshness, source grounding, failed saves, replay prevention, reschedules, derived context and two-user isolation passed");
