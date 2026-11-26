import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const scheduled = { id: "call", company_id: "company", workstream_id: "thread" };
let owned = true;
let matched = "thread";
let reads = [];
let recurring = false;
let manual = false;
let saved = null;
const series = "calendar_root";
const seedId = series + "_20261126T103000Z";
const previousId = series + "_20261125T103000Z";
const otherId = "unrelated_root_20261125T111000Z";
let queries = {};
const fixtures = {
  upcoming_calls: filters => filters.source === "google" ? [
    { id: "other-standup", external_id: otherId, scheduled_at: "2026-11-25T11:10:00Z" },
    { id: "prior-occurrence", external_id: previousId, scheduled_at: "2026-11-25T10:30:00Z" },
  ] : owned ? { ...scheduled, ...(recurring ? { source: "google", external_id: seedId, scheduled_at: "2026-11-26T10:30:00Z", ...(manual ? { intent: "My own agenda", prep: { intentMeta: { source: "manual" } } } : {}) } : {}) } : null,
  interview_sessions: () => [{ session_id: "prior-session", upcoming_id: "prior-occurrence" }],
  interview_summaries: () => recurring ? [{ id: "series-summary", session_id: "prior-session", summary: { headline: "Deployment blocked on test data" } }] : ({ id: "prior", created_at: "2026-11-24", summary: { headline: "Agreed a pilot", notCovered: ["Who signs off on the pilot"] } }),
  tasks: () => [{ id: "task", text: "Send pilot scope", due_at: null }],
  workstreams: () => ({ email_context: "Another contact's email", email_context_meta: { email_context_counterparty_email: "other@example.test" } }),
};
const deps = {
  "next/server": { NextResponse: { json: (body, options) => ({ body, ...options, ok: options.status < 400, json: async () => body }) } },
  "@/lib/request-scope": { requireRequestScope: () => ({ workspaceId: "workspace", userId: "rep" }) },
  "@/lib/uuid": { isUuid: () => true },
  "@/lib/call-subject": { resolveCallLead: async () => ({
    primaryAttendee: { email: "contact@example.test" },
    leadChoices: [{ name: "Contact" }],
    meetingEmail: null,
  }) },
  "@/lib/workstreams": { resolveWorkstreamFromAttendees: async ({ attendees }) => {
    assert.equal(attendees[0].email, "contact@example.test");
    return matched ? { id: matched, companyId: "company" } : null;
  } },
  "@/lib/supabase": { supabaseAdmin: { from(table) {
    const filters = {};
    let patch;
    const query = {
      select: () => query,
      update: value => { patch = value; return query; },
      is: (field, value) => { filters[field] = value; return query; },
      eq: (field, value) => { filters[field] = value; return query; },
      order: () => query,
      like: (field, value) => { filters[field] = value; return query; },
      in: (field, values) => { filters[field] = values; return query; },
      not: () => query,
      lt: () => query,
      gte: () => query,
      limit: () => query,
      maybeSingle: () => query,
      then(resolve) {
        reads.push(table);
        queries[table] = filters;
        assert.equal(filters.workspace_id, "workspace");
        assert.equal(filters.owner_id, "rep");
        if (!recurring && (table === "tasks" || table === "interview_summaries")) {
          assert.equal(filters.workstream_id, "thread");
          assert.equal(filters.company_id, "company");
        }
        if (patch) { saved = patch; resolve({ data: { id: "call" }, error: null }); return; }
        resolve({ data: fixtures[table](filters), error: null });
      },
    };
    return query;
  } } },
};
const seriesModule = { exports: {} };
new Function("exports", ts.transpileModule(readFileSync(new URL("../lib/calendar-series-key.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(seriesModule.exports);
deps["@/lib/calendar-series-key"] = seriesModule.exports;
assert.equal(seriesModule.exports.googleCalendarSeriesKey("microsoft", seedId), null);
assert.equal(seriesModule.exports.googleCalendarSeriesKey("google", "one-off"), null);
const intentModule = { exports: {} };
new Function("exports", ts.transpileModule(readFileSync(new URL("../lib/recurring-prep-intent.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(intentModule.exports);
deps["@/lib/recurring-prep-intent"] = intentModule.exports;
assert.match(intentModule.exports.recurringPrepIntent({
  lastCall: { headline: "Pilot agreed", at: "2026-11-25" },
  gap: "who signs off",
  promises: [{ text: "Send scope", dueAt: "2026-11-27" }],
  email: { context: "Procurement asked for a quote" },
}), /Pilot agreed.*who signs off.*Send scope.*27 Nov.*Procurement asked for a quote/);
const mod = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL("../app/api/crm/upcoming/[id]/brief/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function("require", "module", "exports", code)(name => deps[name], mod, mod.exports);
const get = () => mod.exports.GET(null, { params: { id: "call" } });
const good = await get();
assert.equal(good.status, 200);
assert.equal(good.body.lastCall.id, "prior");
assert.equal(good.body.promises[0].id, "task");
assert.equal(good.body.email, null, "Never reuse another counterparty’s email");
for (const thread of [null, "another-thread"]) {
  reads = [];
  matched = thread;
  const result = await get();
  assert.equal(result.body.lastCall, null);
  assert.deepEqual(result.body.promises, []);
  assert.deepEqual(reads, ["upcoming_calls"]);
}
owned = false;
assert.equal((await get()).status, 404);
console.log("Pre-call brief: scoped history, unmatched contact, stale workstream and unowned event checks passed");

owned = true;
matched = null;
recurring = true;
const team = await get();
assert.equal(team.body.seriesHistory, true);
assert.equal(team.body.lastCall.id, "series-summary");
assert.deepEqual(queries.interview_sessions.upcoming_id, ["prior-occurrence"]);
assert.deepEqual(queries.tasks.source_ref, ["prior-session"]);
console.log("Google series tests passed: no client required; different series excluded; actions scoped to matched sessions");
const post = () => mod.exports.POST(null, { params: { id: "call" } });
assert.match((await post()).body.intent, /Deployment blocked on test data.*Send pilot scope/);
assert.equal(saved.prep.intentMeta.priorCallId, "series-summary");
saved = null;
manual = true;
assert.equal((await post()).body.intent, "My own agenda");
assert.equal(saved, null, "A manual intent must never be changed by prep");
