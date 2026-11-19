import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
const require = createRequire(import.meta.url),
  read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
function compile(path, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(read(path), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      console: { ...console, error() {} },
      Date,
      Set,
      Map,
      URL,
      URLSearchParams,
      Response,
      Headers,
      Request,
      Uint8Array,
      AbortController,
      setTimeout,
      clearTimeout,
      ...globals,
      require: (n) =>
        n === "server-only" ? {} : n in deps ? deps[n] : require(n),
    },
  );
  return exports;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const transcriptLib = compile("lib/coaching-transcript.ts");
const planLib = compile("lib/call-action-plan.ts", {
  "./coaching-transcript": transcriptLib,
});
const transcript =
  "Cam: I will send you the plumbing proposal by Friday.\nBuyer: I will send our website figures tomorrow.\nCam: Let us meet on Tuesday at ten to review the proposal.";
const mine = {
  text: "Prepare plumbing proposal",
  ownerType: "me",
  ownerName: "Cam",
  kind: "document",
  sourceQuote: "I will send you the plumbing proposal by Friday.",
  dueAt: "2026-11-20T23:59:00Z",
  subject: "Plumbing proposal",
  body: "Draft proposal\nBusiness problem: missed plumbing enquiries.\nPrice: [To confirm]",
  coverEmailSubject: "Your plumbing proposal",
  coverEmailBody: "Here is a proposal draft for review.",
  missingDetails: ["Confirm pricing"],
};
const theirs = {
  ...mine,
  text: "Receive website figures",
  ownerType: "counterparty",
  ownerName: "Buyer",
  kind: "task",
  sourceQuote: "I will send our website figures tomorrow.",
  dueAt: "2026-11-20T23:59:00Z",
  body: "Wait for Buyer to provide figures.",
};
const output = {
  actions: [mine, theirs],
  nextCallFocus: "Review the proposal against their enquiry figures",
};
const grounded = planLib.groundCallActionPlan(output, transcript, "Cam");
assert.equal(grounded.actions[0].ownerType, "me");
assert.equal(grounded.actions[1].ownerType, "counterparty");
assert.equal(
  planLib.groundCallActionPlan(
    { actions: [{ ...theirs, ownerType: "me" }], nextCallFocus: "" },
    transcript,
    "Cam",
  ).actions[0].ownerType,
  "unassigned",
  "Another speaker’s promise cannot become the host’s commitment",
);
assert.equal(
  planLib.groundCallActionPlan(
    {
      actions: [{ ...mine, sourceQuote: "A completely invented promise" }],
      nextCallFocus: "",
    },
    transcript,
    "Cam",
  ).actions.length,
  0,
);
assert.equal(
  planLib.groundCallActionPlan(
    {
      actions: [
        {
          ...mine,
          sourceQuote: "Let us meet on Tuesday at ten to review the proposal.",
          dueAt: "nonsense",
        },
      ],
      nextCallFocus: "",
    },
    transcript,
    "Cam",
  ).actions[0].dueAt,
  null,
);
assert.equal(
  planLib.groundCallActionPlan(
    { actions: [mine, mine], nextCallFocus: "" },
    transcript,
    "Cam",
  ).actions.length,
  1,
);
assert.equal(
  planLib.groundCallActionPlan(
    { actions: [], nextCallFocus: "" },
    transcript,
    "Cam",
  ).actions.length,
  0,
);
assert.match(planLib.CALL_ACTION_INSTRUCTIONS, /CALL DATE/);
assert.match(planLib.CALL_ACTION_INSTRUCTIONS, /not.*booked/i);

// Validate the real additive migration. Historic records are not silently
// enrolled in paid preparation, and existing row policies remain in force.
const sql = new PGlite();
await sql.exec(
  `create role authenticated;create role anon;create table follow_ups(workspace_id text,owner_id text,session_id text);create table interview_summaries(id text primary key,workspace_id text,owner_id text,created_at timestamptz default now());insert into interview_summaries(id,workspace_id,owner_id) values ('historic','work','cam');alter table interview_summaries enable row level security;grant select on interview_summaries to authenticated;create policy own on interview_summaries to authenticated using(owner_id=current_setting('request.user',true));`,
);
await sql.exec(
  read("supabase/migrations/20261119222748_call_action_preparation.sql"),
);
await sql.exec(
  "insert into interview_summaries(id,workspace_id,owner_id,post_call_preparation_state) values ('new','work','sharon','pending')",
);
assert.equal(
  (
    await sql.query(
      "select post_call_preparation_state from interview_summaries where id='historic'",
    )
  ).rows[0].post_call_preparation_state,
  null,
);
assert.equal(
  (
    await sql.query(
      "select post_call_preparation_state from interview_summaries where id='new'",
    )
  ).rows[0].post_call_preparation_state,
  "pending",
);
await sql.exec(
  "set role authenticated;select set_config('request.user','cam',false)",
);
assert.equal(
  (await sql.query("select * from interview_summaries")).rows.length,
  1,
);
await sql.exec("reset role");
await sql.close();

const cam = "00000000-0000-4000-8000-000000000011",
  sharon = "00000000-0000-4000-8000-000000000012",
  workspace = "00000000-0000-4000-8000-000000000001",
  callId = "00000000-0000-4000-8000-000000000021";
let scope = {
    userId: cam,
    workspaceId: workspace,
    role: "sales",
    status: "active",
  },
  modelCalls = 0,
  taskFailure = false,
  draftFailure = false,
  modelGate = null;
const rows = {
  interview_summaries: [
    {
      id: callId,
      workspace_id: workspace,
      owner_id: cam,
      session_id: "lc-preparation-call",
      company_id: null,
      created_at: "2026-11-19T14:00:00Z",
      summary: { hostName: "Cam" },
      post_call_preparation_state: "pending",
      post_call_preparation_attempts: 0,
    },
  ],
  interview_sessions: [
    {
      workspace_id: workspace,
      owner_id: cam,
      session_id: "lc-preparation-call",
      transcript,
      started_at: "2026-11-19T14:00:00Z",
    },
  ],
  call_script_plans: [],
  tasks: [],
  follow_ups: [],
};
const db = {
  from(table) {
    let filters = [],
      action = "read",
      payload,
      options;
    const q = {
      select() {
        return q;
      },
      eq(k, v) {
        filters.push((r) => r[k] === v);
        return q;
      },
      is(k, v) {
        filters.push((r) => r[k] == v);
        return q;
      },
      lt(k, v) {
        filters.push((r) => r[k] < v);
        return q;
      },
      in(k, v) {
        filters.push((r) => v.includes(r[k]));
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      update(v) {
        action = "update";
        payload = v;
        return q;
      },
      upsert(v, o) {
        action = "upsert";
        payload = v;
        options = o;
        return q;
      },
      maybeSingle() {
        return run(true);
      },
      single() {
        return run(true);
      },
      then(resolve, reject) {
        return run(false).then(resolve, reject);
      },
    };
    async function run(single) {
      let found = (rows[table] || []).filter((r) => filters.every((f) => f(r)));
      if (action === "update")
        found.forEach((r) => Object.assign(r, plain(payload)));
      if (action === "upsert") {
        if (taskFailure) throw new Error("Interrupted task write");
        if (table === "follow_ups" && draftFailure)
          throw new Error("Draft write interrupted");
        found = [];
        for (const row of payload) {
          const previous = rows[table].find(
            (r) =>
              r.owner_id === row.owner_id &&
              (table === "follow_ups"
                ? r.session_id === row.session_id &&
                  r.source_action_key === row.source_action_key
                : r.fingerprint === row.fingerprint),
          );
          if (previous && options.ignoreDuplicates) continue;
          const inserted = {
            ...plain(row),
            id: `task-${rows[table].length + 1}`,
          };
          rows[table].push(inserted);
          found.push(inserted);
        }
      }
      return { data: plain(single ? found[0] || null : found), error: null };
    }
    return q;
  },
};
const common = {
  "@/lib/supabase": { supabaseService: db, supabaseAdmin: db },
  "@/lib/record-scope": {
    resolveRecordScope: async () => scope,
    privateRecordFields: (s) => ({
      workspace_id: s.workspaceId,
      owner_id: s.userId,
      visibility: "private",
    }),
  },
  "@/lib/text": { capitaliseSentenceStarts: (s) => s },
};
const taskLib = compile("lib/tasks.ts", common);
const preparation = compile("lib/call-action-preparation.ts", {
  ...common,
  "@/lib/assigned-client-access": {
    loadAssignedClientAccess: async () => null,
  },
  "@/lib/speakers": { loadHostIdentityForUser: async () => ({ name: "Cam" }) },
  "@/lib/coaching-transcript": transcriptLib,
  "@/lib/call-action-plan": planLib,
  "@/lib/tasks": taskLib,
  "@/lib/usage": { logModelUsage: async () => {} },
  "@/lib/openai": {
    OPENAI_MODEL_PRO: "fixture",
    openai: {
      messages: {
        create: async (args) => {
          modelCalls++;
          assert.match(args.messages[0].content, /2026-11-19T14:00/);
          if (modelGate) await modelGate;
          return { content: [{ type: "text", text: JSON.stringify(output) }] };
        },
      },
    },
  },
});
taskFailure = true;
await preparation.prepareCallActions(callId);
assert.equal(modelCalls, 1);
assert.equal(rows.interview_summaries[0].post_call_preparation_state, "error");
assert.ok(
  rows.interview_summaries[0].post_call_package.actionPreparation.actions[0].body.includes(
    "Draft proposal",
  ),
  "Draft survives a subsequent failed task save",
);
taskFailure = false;
draftFailure = true;
await preparation.prepareCallActions(callId, { manual: true });
assert.equal(rows.interview_summaries[0].post_call_preparation_state, "error");
assert.match(
  rows.interview_summaries[0].post_call_preparation_error,
  /tasks are saved/,
);
assert.equal(rows.tasks.length, 2);
draftFailure = false;
await preparation.prepareCallActions(callId, { manual: true });
assert.equal(modelCalls, 1, "Recovery reuses the saved draft checkpoint");
assert.equal(rows.tasks.length, 2);
assert.equal(
  rows.tasks[0].company_id,
  null,
  "An unlinked call still creates a personal action",
);
assert.equal(rows.tasks[1].kind, "counterparty_commitment");
assert.equal(
  rows.follow_ups.length,
  1,
  "The covering email is also available in native Drafts",
);
rows.follow_ups[0].status = "sent";
assert.equal(rows.interview_summaries[0].post_call_preparation_state, "ready");
rows.tasks[0].status = "done";
rows.interview_summaries[0].post_call_preparation_state = "error";
rows.interview_summaries[0].post_call_preparation_lease = null;
await preparation.prepareCallActions(callId, { manual: true });
assert.equal(rows.tasks.length, 2);
assert.equal(
  rows.tasks[0].status,
  "done",
  "Recovery never reopens or duplicates a completed task",
);
assert.equal(modelCalls, 1);
assert.equal(rows.follow_ups.length, 1);
assert.equal(
  rows.follow_ups[0].status,
  "sent",
  "Recovery preserves sent drafts",
);
scope = { ...scope, userId: sharon };
await assert.rejects(preparation.prepareCallActions(callId), /unavailable/);
assert.equal(modelCalls, 1);
scope = { ...scope, userId: cam, workspaceId: "other" };
await assert.rejects(preparation.prepareCallActions(callId), /unavailable/);
scope = { ...scope, workspaceId: workspace };
const second = {
  ...plain(rows.interview_summaries[0]),
  id: "00000000-0000-4000-8000-000000000022",
  post_call_package: null,
  post_call_preparation_state: "pending",
  post_call_preparation_attempts: 0,
  post_call_preparation_lease: null,
};
rows.interview_summaries.push(second);
let release;
modelGate = new Promise((r) => (release = r));
const first = preparation.prepareCallActions(second.id);
await new Promise((r) => setTimeout(r, 5));
await preparation.prepareCallActions(second.id);
assert.equal(modelCalls, 2, "An active lease prevents a second generation");
release();
await first;
modelGate = null;
second.post_call_preparation_state = null;
second.post_call_package = null;
await preparation.prepareCallActions(second.id);
assert.equal(modelCalls, 2, "Historic calls are opt-in");

const access = compile("lib/assigned-client-access.ts", {
  "@/lib/supabase": {
    supabaseAdmin: {
      from() {
        throw new Error("Unscoped background client");
      },
    },
  },
  "@/lib/team-lead-cover": { loadTeamLeadCoverCompany: async () => null },
  "@/lib/team-client-sharing": {
    loadSafeSharedCompany: async () => ({ id: "client" }),
  },
});
let grants = false;
const accessClient = {
  from(table) {
    let filters = [];
    return {
      select() {
        return this;
      },
      eq(k, v) {
        filters.push([k, v]);
        return this;
      },
      async maybeSingle() {
        assert.ok(
          filters.some(
            ([k, v]) => k === "workspace_id" && v === scope.workspaceId,
          ),
        );
        return {
          data: table === "companies" ? null : grants ? { id: "grant" } : null,
          error: null,
        };
      },
    };
  },
};
assert.equal(
  await access.loadAssignedClientAccess("client", scope, accessClient),
  null,
);
grants = true;
assert.equal(
  (await access.loadAssignedClientAccess("client", scope, accessClient)).mode,
  "shared_sales",
);
let queued = 0;
const route = compile("app/api/crm/call-actions/route.ts", {
  ...common,
  "@/lib/request-scope": { requireRequestScope: () => scope },
  "@/lib/call-action-preparation": {
    prepareCallActions: async () => {
      queued++;
    },
  },
  "@/lib/crm-blocker": { crmBlockerPayload: (v) => ({ error: v.reason }) },
  "next/server": { NextResponse: { json: (v, o) => Response.json(v, o) } },
  "@vercel/functions": { waitUntil: () => {} },
});
const request = (query) => ({ nextUrl: new URL(`https://test/api?${query}`) });
let response = await route.GET(request(`callId=${callId}`));
assert.equal(response.status, 200);
assert.equal(queued, 0, "Reading never generates actions");
response = await route.GET(
  request(`callId=${callId}&download=1&actionId=${grounded.actions[0].id}`),
);
assert.equal(response.status, 200);
const bytes = new Uint8Array(await response.arrayBuffer());
assert.equal(
  String.fromCharCode(...bytes.slice(0, 2)),
  "PK",
  "A real Word file is downloadable",
);
assert.match(response.headers.get("content-disposition"), /\.docx/);
scope = { ...scope, userId: sharon };
assert.equal((await route.GET(request(`callId=${callId}`))).status, 404);
assert.equal(
  (await route.POST({ json: async () => ({ callId }) })).status,
  404,
);
scope = { ...scope, userId: cam };

// The saved-summary path also invokes preparation, so refresh/retry/recovery
// cannot skip the action pack merely because the scorecard already exists.
let preparedCached = 0;
const jobs = compile("lib/call-summary-jobs.ts", {
  ...common,
  "@/lib/call-action-preparation": {
    prepareCallActions: async () => preparedCached++,
  },
  "@/lib/workstreams": {
    resolveCallScope: async () => ({ companyId: null, workstream: null }),
  },
  "@/app/api/interview/summary/route": {
    POST: () => {
      throw new Error("Must not regenerate summary");
    },
  },
  "next/server": { NextRequest: Request },
});
const job = await jobs.runCallSummaryJob(new Request("https://test"), {
  sessionId: "lc-preparation-call",
  transcript,
});
assert.equal(job.alreadyDone, true);
assert.equal(preparedCached, 1);

const dom = new JSDOM('<div id="root"></div>', { url: "https://test" });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
global.IS_REACT_ACT_ENVIRONMENT = true;
let posts = 0,
  reads = 0;
const panel = compile("components/CallActionPack.tsx", {
  "@/lib/crm": {
    crmFetch: async (_url, opts) => {
      if (opts?.method === "POST") {
        posts++;
        return { ok: true };
      }
      reads++;
      return { callId, state: "ready", error: null, plan: grounded };
    },
  },
  "next/link": ({ children }) => React.createElement("span", null, children),
}).default;
const root = createRoot(document.getElementById("root"));
await act(async () => {
  root.render(React.createElement(panel, { callId }));
  await new Promise((r) => setTimeout(r, 5));
});
assert.equal(posts, 0);
assert.equal(reads, 1);
assert.match(document.body.textContent, /Draft proposal/);
assert.match(document.body.textContent, /Waiting on them/);
assert.match(document.body.textContent, /Confirm pricing/);
assert.equal(document.querySelectorAll("a[download]").length, 0);
assert.ok(
  [...document.querySelectorAll("a")].some((a) =>
    a.href.includes("download=1"),
  ),
);
await act(async () => root.unmount());
dom.window.close();
assert.match(
  read("app/api/interview/backfill-scorecards/route.ts"),
  /recoverCallActionPreparation\(\)/,
);
assert.doesNotMatch(
  read("app/api/interview/session-end/route.ts"),
  /post\("\/api\/crm\/commitments\/detect"/,
);
assert.match(
  read("app/api/crm/update-profile/route.ts"),
  /if \(!canonicalActions\)/,
);
console.log(
  "Action drafts and Word download, quote/owner/deadline grounding, unlinked calls, recovery checkpoint, stable task receipts, completed-task preservation, concurrent leases, cached-summary recovery, historic opt-in, private APIs and actual React display passed",
);
