import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
const require = createRequire(import.meta.url);
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const plain = v => JSON.parse(JSON.stringify(v));
function compile(path, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, Date, JSON, Intl, console, URL, Response, setTimeout, clearTimeout, require: n => n === "server-only" ? {} : n in deps ? deps[n] : require(n) });
  return exports;
}
const content = compile("lib/call-recap.ts");
const transcript = "You: We discussed a five minute demo for the admissions team.\nJane: I will send the requirements by Friday.\nYou: I will send the pilot outline tomorrow.\nJane: We agreed to start with one department.";
const proposed = { shareable: true,
  points: [{ text: "We discussed a short demonstration for the admissions team.", evidence: "You: We discussed a five minute demo for the admissions team." }],
  decisions: [{ text: "Start with one department.", evidence: "Jane: We agreed to start with one department." }],
  actions: [{ task: "Send the requirements", owner: "Jane", due: "Friday", evidence: "Jane: I will send the requirements by Friday." },
    { task: "Send the pilot outline", owner: "Lee", due: "tomorrow", evidence: "You: I will send the pilot outline tomorrow." }],
  secretInternalField: "PRIVATE_NEGOTIATION_LIMIT",
};
const recap = content.validateCallRecap(proposed, transcript, "Lee");
assert.equal(recap.actions[1].owner, "Lee");
const email = content.renderCallRecap(recap, "2026-11-23T15:15:00Z");
assert.match(email.text, /Next actions/);
assert.match(email.subject, /Meeting recap with Jane/);
assert.match(email.text, /Jane — Send the requirements · Friday/);
assert.doesNotMatch(JSON.stringify(email), /PRIVATE_NEGOTIATION_LIMIT|evidence|api\/crm|scorecard/);
assert.doesNotMatch(email.html, /href=/, "Forwardable email has no private CRM links");
assert.throws(() => content.validateCallRecap({ ...proposed, actions: [{ ...proposed.actions[0], due: "26 November" }] }, transcript, "Lee"), /REVIEW_REQUIRED/);
assert.throws(() => content.validateCallRecap({ ...proposed, actions: [{ ...proposed.actions[0], owner: "Sharon" }] }, transcript, "Lee"), /REVIEW_REQUIRED/);
assert.throws(() => content.validateCallRecap({ ...proposed, points: [{ text: "Secret profit margin is 90%", evidence: transcript.slice(0, 60) }] }, transcript, "Lee"), /REVIEW_REQUIRED/);
assert.throws(() => content.validateCallRecap({ ...proposed, shareable: false }, transcript, "Lee"), /REVIEW_REQUIRED/);
assert.equal(content.recapPreference("not json").enabled, false);
assert.equal(content.recapPreference('{"enabled":true}').enabled, false);
assert.match(content.CALL_RECAP_INSTRUCTIONS, /untrusted evidence/);
assert.equal(content.CALL_RECAP_FORMAT.strict, true);
assert.throws(() => content.validateCallRecap({ ...proposed, points: [{ text: "A safe point", evidence: "A quote from some other call entirely" }] }, transcript, "Lee"), /RECAP_REVIEW_REQUIRED_EVIDENCE/);
assert.match(content.callRecapReviewMessage("RECAP_REVIEW_REQUIRED_EVIDENCE"), /quote could not be matched exactly/);
assert.doesNotMatch(content.callRecapReviewMessage("DATABASE_PRIVATE_SECRET"), /DATABASE_PRIVATE_SECRET/);

const workspace = "00000000-0000-4000-8000-000000000001", lee = "00000000-0000-4000-8000-000000000002", cam = "00000000-0000-4000-8000-000000000003";
const callId = "00000000-0000-4000-8000-000000000004";
let scope = { userId: lee, workspaceId: workspace };
let rows, sent, modelCalls, gate, hold, sendFailure, failSentSave, failRead, providerHook, modelResponse;
const enabledSince = "2026-11-23T14:00:00.000Z";
function reset() {
  scope = { userId: lee, workspaceId: workspace };
  rows = {
    workspace_members: [{ user_id: lee, workspace_id: workspace, status: "active" }, { user_id: cam, workspace_id: workspace, status: "active" }],
    app_config: [{ key: content.CALL_RECAP_KEY, workspace_id: workspace, owner_id: lee, visibility: "private", value: JSON.stringify({ enabled: true, enabledSince }) }],
    interview_summaries: [{ id: callId, session_id: "s1", workspace_id: workspace, owner_id: lee, created_at: "2026-11-23T16:15:00.000Z", summary: { private: "PRIVATE_NEGOTIATION_LIMIT" } }],
    interview_sessions: [{ session_id: "s1", workspace_id: workspace, owner_id: lee, transcript, started_at: "2026-11-23T15:15:00Z", ended_at: "2026-11-23T16:15:00Z", created_at: "2026-11-23T15:00:00Z", brief: "PRIVATE_PREP" }],
    call_recap_emails: [{ id: "receipt", call_id: callId, session_id: "s1", workspace_id: workspace, owner_id: lee, status: "queued", attempts: 0, lease_until: null, created_at: "2026-11-23T16:16:00Z" }],
  };
  sent = []; modelCalls = 0; gate = null; hold = false; sendFailure = false; failSentSave = false; failRead = null; providerHook = null; modelResponse = null;
}
const db = { from(table) {
  let filters = [], orders = [], limit = Infinity, action = "read", payload, single = false;
  const q = {
    select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
    in(k, v) { filters.push(r => v.includes(r[k])); return q; },
    gte(k, v) { filters.push(r => r[k] >= v); return q; },
    order(k, o) { orders.push([k, o?.ascending !== false]); return q; }, limit(v) { limit = v; return q; },
    or(expr) {
      if (expr.startsWith("lease_until")) { const cutoff = expr.split(".lte.")[1]; filters.push(r => !r.lease_until || r.lease_until <= cutoff); }
      else { const m = expr.match(/created_at.gt.([^,]+),and\(created_at.eq.[^,]+,id.gt.([^\)]+)\)/); assert.ok(m); filters.push(r => r.created_at > m[1] || r.created_at === m[1] && r.id > m[2]); }
      return q;
    },
    update(p) { action = "update"; payload = p; return q; },
    upsert(p) { action = "upsert"; payload = p; return q; },
    maybeSingle() { single = true; return q; },
    then(resolve, reject) { return Promise.resolve().then(() => {
      if (failRead === table && action === "read") return { data: null, error: new Error("read unavailable") };
      let matched = rows[table].filter(r => filters.every(f => f(r)));
      for (const [k, asc] of [...orders].reverse()) matched.sort((a,b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1));
      matched = matched.slice(0, limit);
      if (action === "update") {
        if (failSentSave && payload.status === "sent") return { data: null, error: new Error("write lost") };
        matched.forEach(r => Object.assign(r, plain(payload)));
      }
      if (action === "upsert") {
        for (const p of payload) if (!rows[table].some(r => r.workspace_id === p.workspace_id && r.owner_id === p.owner_id && r.session_id === p.session_id))
          rows[table].push({ id: `receipt-${rows[table].length}`, status: "queued", attempts: 0, lease_until: null, created_at: new Date().toISOString(), ...plain(p) });
      }
      return { data: plain(single ? matched[0] || null : matched), error: null };
    }).then(resolve, reject); },
  }; return q;
} };
const deps = {
  "@/lib/supabase": { supabaseService: db },
  "@/lib/record-scope": { resolveRecordScope: async () => ({ ...scope }) },
  "@/lib/app-config": { setAppConfigValue: async p => {
    let r = rows.app_config.find(r => r.key === p.key && r.owner_id === scope.userId && r.workspace_id === scope.workspaceId);
    if (!r) { r = { ...scope, owner_id: scope.userId, workspace_id: scope.workspaceId, visibility: "private" }; rows.app_config.push(r); }
    Object.assign(r, p); return plain(r);
  } },
  "@/lib/mail": { connectedMailProvider: async ownerId => { assert.equal(ownerId, scope.userId); if (providerHook) providerHook(); return { provider: "google", email: ownerId === lee ? "lee@example.test" : "cam@example.test" }; },
    sendConnectedMail: async (message, ownerId) => { sent.push({ ...plain(message), ownerId }); if (sendFailure) throw new Error("network timeout"); return { ok: true, id: "provider-message" }; } },
  "@/lib/speakers": { loadHostIdentityForUser: async (owner, work) => { assert.equal(owner, scope.userId); assert.equal(work, scope.workspaceId); return { name: "Lee" }; } },
  "@/lib/openai": { OPENAI_MODEL_LIVE: "test-model", openai: { messages: { create: async p => {
    modelCalls++; assert.doesNotMatch(JSON.stringify(p), /PRIVATE_PREP|PRIVATE_NEGOTIATION_LIMIT/);
    if (gate) await gate;
    const review = p.max_tokens === 100;
    if (!review) {
      assert.equal(p.response_format.name, "shareable_call_recap");
      assert.equal(p.response_format.strict, true);
      if (modelResponse) return modelResponse;
    }
    return { content: [{ type: "text", text: review ? hold ? "HOLD" : "APPROVE" : JSON.stringify(proposed) }], usage: {} };
  } } } },
  "@/lib/usage": { logModelUsage: async () => {} }, "@/lib/call-recap": content,
};
const worker = compile("lib/call-recap-email.ts", deps);
reset();
await worker.processCallRecapEmail("receipt");
assert.equal(sent.length, 1); assert.equal(sent[0].to, "lee@example.test");
assert.equal(rows.call_recap_emails[0].status, "sent"); assert.equal(modelCalls, 2);
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 1); assert.equal(modelCalls, 2);
await worker.discoverCallRecapEmails(); await worker.discoverCallRecapEmails();
assert.equal(rows.call_recap_emails.length, 1, "Discovery never duplicates a canonical session");
reset(); scope.userId = cam;
assert.equal((await worker.getCallRecapPreference()).enabled, false);
assert.equal((await worker.getCallRecapReceipts()).length, 0);
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0);
await worker.saveCallRecapPreference(true);
await assert.rejects(worker.processCallRecapEmail("receipt"), /ACCESS_DENIED/);
reset(); scope.workspaceId = "different";
await assert.rejects(worker.getCallRecapPreference(), /ACCESS_DENIED/);
reset(); rows.workspace_members[0].status = "suspended";
await assert.rejects(worker.processCallRecapEmail("receipt"), /ACCESS_DENIED/); assert.equal(sent.length, 0);
reset(); rows.app_config[0].visibility = "team";
assert.equal((await worker.getCallRecapPreference()).enabled, false, "Never inherit team opt-in");
reset(); hold = true;
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0); assert.equal(rows.call_recap_emails[0].status, "needs_review");
assert.match(rows.call_recap_emails[0].last_error, /privacy check could not approve/);
reset(); modelResponse = { content: [{ type: "text", text: "{truncated" }], stop_reason: "max_tokens" };
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0); assert.equal(modelCalls, 1);
assert.match(rows.call_recap_emails[0].last_error, /not returned in a complete readable format/);
reset(); modelResponse = { content: [{ type: "text", text: JSON.stringify({ ...proposed, actions: [{ ...proposed.actions[0], due: "Wednesday" }] }) }] };
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0); assert.equal(modelCalls, 1);
assert.match(rows.call_recap_emails[0].last_error, /action owner, date or supporting quote/);
reset(); sendFailure = true;
await worker.processCallRecapEmail("receipt"); await worker.processCallRecapEmail("receipt");
assert.equal(sent.length, 1); assert.equal(rows.call_recap_emails[0].status, "uncertain");
reset(); failSentSave = true;
await worker.processCallRecapEmail("receipt"); await worker.processCallRecapEmail("receipt");
assert.equal(sent.length, 1, "Lost receipt after acceptance must never duplicate send");
reset(); rows.call_recap_emails[0].status = "sending";
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0); assert.equal(rows.call_recap_emails[0].status, "uncertain");
reset(); failRead = "interview_sessions";
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0); assert.equal(rows.call_recap_emails[0].status, "queued");
reset(); rows.interview_sessions[0].owner_id = cam;
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0); assert.equal(modelCalls, 0);
reset(); rows.interview_sessions[0].ended_at = null;
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0, "Never email an unfinished call");
reset(); let release;
gate = new Promise(r => { release = r; });
const running = worker.processCallRecapEmail("receipt");
await new Promise(r => setTimeout(r, 10));
await worker.processCallRecapEmail("receipt");
assert.equal(modelCalls, 1, "Concurrent jobs share one claim"); release(); await running;
assert.equal(sent.length, 1);
reset(); gate = new Promise(r => { release = r; });
const disableDuringPrep = worker.processCallRecapEmail("receipt");
await new Promise(r => setTimeout(r, 10));
await worker.saveCallRecapPreference(false); release(); await disableDuringPrep;
assert.equal(sent.length, 0, "Opt-out during preparation blocks delivery");
reset(); gate = new Promise(r => { release = r; });
const revokeDuringPrep = worker.processCallRecapEmail("receipt");
await new Promise(r => setTimeout(r, 10));
rows.workspace_members[0].status = "removed"; release(); await revokeDuringPrep;
assert.equal(sent.length, 0, "Revocation during preparation blocks delivery");
reset(); rows.interview_sessions[0].ended_at = "2026-11-22T16:15:00Z";
await worker.processCallRecapEmail("receipt"); assert.equal(sent.length, 0); assert.equal(rows.call_recap_emails[0].status, "skipped");
reset(); rows.call_recap_emails = [];
rows.interview_summaries = Array.from({ length: 101 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12,"0")}`, session_id: `s${i}`, workspace_id: workspace, owner_id: lee, created_at: "2026-11-23T16:15:00.123456+00:00" }));
await worker.discoverCallRecapEmails(); await worker.discoverCallRecapEmails(); await worker.discoverCallRecapEmails(); await worker.discoverCallRecapEmails();
assert.equal(rows.call_recap_emails.length, 101, "Pagination handles tied Postgres microseconds without dropping or duplicating calls");

const route = compile("app/api/crm/call-recap-emails/route.ts", {
  "next/server": { NextResponse: { json: (v,o) => Response.json(v,o) } },
  "@/lib/request-scope": { requireRequestScope: () => ({ ...scope, status: rows.workspace_members.find(r => r.user_id === scope.userId)?.status }) },
  "@/lib/call-recap-email": worker,
  "@/lib/crm-blocker": { crmBlockerPayload: v => ({ error: v.reason }) },
});
reset();
assert.equal((await route.PUT({ json: async () => ({ enabled: true, recipient: "prospect@example.test" }) })).status, 400);
assert.equal((await route.PUT({ json: async () => ({ enabled: "yes" }) })).status, 400);
assert.equal((await route.PUT({ json: async () => ({ enabled: true, owner_id: cam }) })).status, 400);
assert.equal((await route.PUT({ json: async () => ({ enabled: false }) })).status, 200);
const get = await route.GET({ nextUrl: new URL("https://test/api?callId=" + callId) });
assert.equal(get.status, 200); assert.equal(get.headers.get("cache-control"), "private, no-store");
rows.workspace_members[0].status = "removed";
assert.equal((await route.PUT({ json: async () => ({ enabled: true }) })).status, 403);

// Exercise the real migration in Postgres, not just source regexes.
const sql = new PGlite();
await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.user', true),'')::uuid $$;
create table auth.users(id uuid primary key); create table public.workspaces(id uuid primary key);
create table public.workspace_members(workspace_id uuid,user_id uuid,status text);
create table public.interview_summaries(id uuid primary key);
grant usage on schema public,auth to authenticated,anon; grant select on public.workspace_members to authenticated;
insert into auth.users values ('${lee}'),('${cam}'); insert into workspaces values ('${workspace}');
insert into workspace_members values ('${workspace}','${lee}','active'),('${workspace}','${cam}','active');
insert into interview_summaries values ('${callId}');`);
await sql.exec(read("supabase/migrations/20261123164457_call_recap_emails.sql"));
await sql.exec(`insert into call_recap_emails(workspace_id,owner_id,call_id,session_id) values ('${workspace}','${lee}','${callId}','s1'),('${workspace}','${cam}','${callId}','s2');`);
await sql.exec(`set role authenticated; select set_config('request.user','${lee}',false);`);
assert.equal((await sql.query("select * from call_recap_emails")).rows.length, 1);
await assert.rejects(sql.exec("update call_recap_emails set recipient='attacker@example.test'"), /permission denied/);
await sql.exec(`select set_config('request.user','${cam}',false);`);
assert.equal((await sql.query("select * from call_recap_emails where session_id='s1'")).rows.length, 0);
await sql.exec(`reset role; update workspace_members set status='removed' where user_id='${cam}'; set role authenticated;`);
assert.equal((await sql.query("select * from call_recap_emails")).rows.length, 0);
await sql.exec("reset role; set role anon;");
await assert.rejects(sql.query("select * from call_recap_emails"), /permission denied/);
await sql.close();

const dom = new JSDOM('<div id="root"></div>', { url: "https://test" });
global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
let uiPuts = 0;
const Panel = compile("components/CallRecapEmails.tsx", {
  "@/lib/crm": { crmFetch: async (_url, options) => {
    if (options?.method) { uiPuts++; return { ok: true, enabled: false }; }
    return { enabled: true, receipts: [{ call_id: callId, status: "uncertain", last_error: "Check sent mail before contacting support.", created_at: enabledSince }] };
  } },
  "next/link": ({ children, href }) => React.createElement("a", { href }, children),
}).default;
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(Panel)); await new Promise(r => setTimeout(r, 10)); });
assert.match(document.body.textContent, /Delivery needs checking/); assert.match(document.body.textContent, /Prospects are never emailed automatically/);
assert.equal(uiPuts, 0, "Opening Settings is read-only");
await act(async () => { document.querySelector("button").click(); });
assert.equal(uiPuts, 1); assert.match(document.body.textContent, /Off · turn on/);
await act(async () => root.unmount()); dom.window.close();
assert.ok(JSON.parse(read("vercel.json")).crons.some(c => c.path === "/api/cron/call-recap-emails" && c.schedule === "*/5 * * * *"));
console.log("Call recap grounding, privacy, recipient isolation, opt-in, concurrency, retries, uncertain sends, RLS and actual settings UI passed");
