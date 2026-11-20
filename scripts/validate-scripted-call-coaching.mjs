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
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
function compile(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(read(file), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      console,
      Set,
      Map,
      Date,
      URL,
      URLSearchParams,
      Response,
      setTimeout,
      clearTimeout,
      ...globals,
      require(name) {
        if (name === "server-only") return {};
        if (name in deps) return deps[name];
        return require(name);
      },
    },
    { filename: file },
  );
  return exports;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const script = compile("lib/sales-call-script.ts");
assert.notEqual(script.ADAM_SCRIPT.version,script.ADAM_SCRIPT_V1.version);
assert.equal(script.approvedAdamScript(script.ADAM_SCRIPT_V1.version).steps[1].title,'Discovery');
assert.match(script.scriptContext(['adam'],'hook',script.ADAM_SCRIPT_V1.version),/adam-2026-11-19-v1/);
assert.equal(script.nextTimeline([],{products:['adam'],stage:'hook',elapsedSeconds:0,transcriptChars:0},undefined,script.ADAM_SCRIPT_V1.version)[0].version,script.ADAM_SCRIPT_V1.version);
const reportLib = compile("lib/script-coaching-report.ts", {
  "./sales-call-script": script,
});
assert.deepEqual(
  plain(script.cleanProducts(["training", "adam", "adam", "fake"])),
  ["adam", "training"],
);
assert.equal(script.cleanStage("injected"), "listen");
assert.equal(script.approvedAdamScript(script.ADAM_SCRIPT_V2.version).steps.length, 5, "Old reports retain their original script");
assert.deepEqual(plain(script.ADAM_SCRIPT.steps.map(step => step.id)), ["listen", "demo", "close"]);
assert.ok(script.ADAM_SCRIPT.steps.every(step => step.questions.length === 3));
assert.equal(script.cleanStage("next_step"), "close");
assert.equal(script.cleanStage("discovery"), "listen");
assert.equal(script.cleanStage("discovery", script.ADAM_SCRIPT_V2.version), "discovery");
assert.match(
  script.scriptContext(["adam", "recruitment"], "demo"),
  /combined script has not been approved/,
);
assert.match(script.scriptContext(["training"], "close"), /No approved script/);
assert.equal(script.scriptContext([], "hook"), "");
assert.equal(
  script.isSpokenObjection("I'm worried it won't work for blocked drains"),
  true,
);
assert.equal(
  script.isSpokenObjection("We help customers with blocked drains"),
  false,
);
let timeline = script.nextTimeline([], {
  products: ["adam"],
  stage: "hook",
  elapsedSeconds: 0,
  transcriptChars: 0,
});
assert.equal(
  script.nextTimeline(timeline, {
    products: ["adam"],
    stage: "hook",
    elapsedSeconds: 10,
    transcriptChars: 100,
  }).length,
  1,
);
timeline = script.nextTimeline(timeline, {
  products: ["recruitment"],
  stage: "discovery",
  elapsedSeconds: 30,
  transcriptChars: 500,
});
assert.equal(timeline[1].version, null);
assert.equal(timeline[1].transcriptChars, 500);
const baseReport = {
  headline: "Good discovery",
  strengths: ["Used their scenario"],
  improvements: ["Agree a dated follow-up"],
  nextCallFocus: "Agree a next step",
  intentOutcome: "A recruitment conversation",
  switchReview: "The prospect redirected the conversation",
  criteria: [
    {
      product: "adam",
      stageId: "listen",
      status: "met",
      evidenceQuote: "I noticed your missed plumbing enquiries",
      explanation: "Specific opening",
      betterNextTime: "",
    },
    {
      product: "adam",
      stageId: "close",
      status: "missed",
      evidenceQuote: "",
      explanation: "No close",
      betterNextTime: "Ask for a decision",
    },
  ],
};
const transcript =
  "Cam: I noticed your missed plumbing enquiries.\nBuyer: We need recruitment instead.";
const redirected = reportLib.groundedReport(
  baseReport,
  transcript,
  script.ADAM_SCRIPT,
  timeline,
);
assert.equal(
  redirected.score,
  100,
  "A product redirect must not penalise the uncompleted close",
);
assert.equal(redirected.criteria[1].status, "not_applicable");
assert.equal(
  reportLib.groundedReport(baseReport, transcript, {}).score,
  null,
  "No invented scores without an approved script",
);
assert.equal(
  reportLib.groundedReport(baseReport, transcript, script.ADAM_SCRIPT, [
    { products: ["training"] },
  ]).score,
  null,
);
const invented = reportLib.groundedReport(
  {
    ...baseReport,
    criteria: [
      {
        ...baseReport.criteria[0],
        evidenceQuote: "Invented words never spoken",
      },
    ],
  },
  transcript,
  script.ADAM_SCRIPT,
);
assert.equal(invented.criteria[0].status, "unverifiable");
assert.equal(invented.score, null);
assert.throws(() =>
  reportLib.groundedReport(
    { ...baseReport, improvements: ["a", "b", "c"] },
    transcript,
    script.ADAM_SCRIPT,
  ),
);
const weekly = reportLib.weeklyCoaching(
  ["cam", "sharon"].map((ownerId) => ({
    ownerId,
    report: {
      criteria: [baseReport.criteria[1]],
      nextCallFocus: "Agree next steps",
    },
  })),
);
assert.equal(weekly.repeatedGaps[0].reviewScript, true);

// Execute the migration in PostgreSQL, then query as authenticated users.
const db = new PGlite();
const workspace = "00000000-0000-4000-8000-000000000001",
  otherWorkspace = "00000000-0000-4000-8000-000000000002";
const cam = "00000000-0000-4000-8000-000000000011",
  sharon = "00000000-0000-4000-8000-000000000012",
  lee = "00000000-0000-4000-8000-000000000013",
  outsider = "00000000-0000-4000-8000-000000000014";
const callId = "00000000-0000-4000-8000-000000000021";
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key); create table workspaces(id uuid primary key); create table companies(id uuid primary key); create table interview_summaries(id uuid primary key);
create table workspace_members(workspace_id uuid,user_id uuid,status text,role text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to authenticated; grant execute on function auth.uid() to authenticated; grant select on workspace_members to authenticated;
insert into auth.users values ('${cam}'),('${sharon}'),('${lee}'),('${outsider}'); insert into workspaces values ('${workspace}'),('${otherWorkspace}'); insert into interview_summaries values ('${callId}');
insert into workspace_members values ('${workspace}','${cam}','active','sales'),('${workspace}','${sharon}','active','sales'),('${workspace}','${lee}','active','owner'),('${otherWorkspace}','${outsider}','active','owner');`);
await db.exec(
  read("supabase/migrations/20261119214917_scripted_sales_call_coaching.sql"),
);
await db.exec(`insert into call_script_plans(workspace_id,owner_id,context_key) values ('${workspace}','${cam}','draft:unscheduled'),('${workspace}','${sharon}','draft:unscheduled');
insert into script_call_coaching(workspace_id,owner_id,session_id,call_id) values ('${workspace}','${cam}','lc-camcall','${callId}'),('${workspace}','${sharon}','lc-sharoncall','${callId}');`);
async function asUser(user, query) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`,
  );
  try {
    return await db.query(query);
  } finally {
    await db.exec("reset role");
  }
}
assert.equal(
  (await asUser(cam, "select * from call_script_plans")).rows.length,
  1,
);
assert.equal(
  (await asUser(cam, "select * from script_call_coaching")).rows.length,
  1,
);
assert.equal(
  (await asUser(lee, "select * from script_call_coaching")).rows.length,
  2,
);
assert.equal(
  (await asUser(outsider, "select * from script_call_coaching")).rows.length,
  0,
);
await assert.rejects(
  asUser(
    cam,
    `insert into call_script_plans(workspace_id,owner_id,context_key) values ('${workspace}','${sharon}','draft:stolen')`,
  ),
  /row-level security/,
);
await assert.rejects(
  asUser(cam, "select * from client_product_interests"),
  /permission denied/,
);
await assert.rejects(
  asUser(cam, "update script_call_coaching set report='{}'"),
  /permission denied/,
);
await db.exec(
  `update workspace_members set status='suspended' where user_id='${cam}'`,
);
assert.equal(
  (await asUser(cam, "select * from call_script_plans")).rows.length,
  0,
);
await db.close();

// Run real routes with a filtering database fixture, including denied reads,
// compare-and-swap conflicts, and a partially confirmed two-step save.
let scope = {
  userId: cam,
  workspaceId: workspace,
  role: "sales",
  status: "active",
};
let errorTable = "",
  clientAllowed = true;
const rows = {
  call_script_plans: [],
  client_product_interests: [],
  script_call_coaching: [],
  interview_summaries: [
    {
      id: callId,
      owner_id: sharon,
      workspace_id: workspace,
      session_id: "lc-sharoncall",
    },
  ],
  profiles: [],
  workspace_members: [],
  interview_sessions: [],
};
let modelCalls = 0;
const database = {
  from(table) {
    const filters = [];
    let action = "select",
      payload,
      ignoreDuplicates = false;
    const q = {
      select() {
        return q;
      },
      eq(k, v) {
        filters.push((r) => r[k] === v);
        return q;
      },
      gte(k, v) {
        filters.push((r) => r[k] >= v);
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
      insert(v) {
        action = "insert";
        payload = v;
        return q;
      },
      update(v) {
        action = "update";
        payload = v;
        return q;
      },
      upsert(v, opts) {
        action = "upsert";
        payload = v;
        ignoreDuplicates = opts?.ignoreDuplicates;
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
      if (table === errorTable)
        return { data: null, error: new Error("private database detail") };
      let selected = (rows[table] || []).filter((r) =>
        filters.every((f) => f(r)),
      );
      if (action === "insert") {
        rows[table].push({ ...payload });
        selected = [payload];
      }
      if (action === "update") {
        selected.forEach((r) => Object.assign(r, payload));
      }
      if (action === "upsert") {
        const existing = rows[table].find(
          (r) =>
            r.workspace_id === payload.workspace_id &&
            (table === "client_product_interests"
              ? r.company_id === payload.company_id
              : r.owner_id === payload.owner_id &&
                r.session_id === payload.session_id),
        );
        if (existing) {
          if (!ignoreDuplicates) Object.assign(existing, payload);
          selected = ignoreDuplicates ? [] : [existing];
        } else {
          rows[table].push({ ...payload });
          selected = [payload];
        }
      }
      return {
        data: single ? selected[0] || null : selected,
        error: null,
        count: selected.length,
      };
    }
    return q;
  },
};
const common = {
  "@/lib/request-scope": { requireRequestScope: () => scope },
  "@/lib/supabase": { supabaseAdmin: database, supabaseService: database },
  "@/lib/crm-blocker": {
    crmBlockerPayload: (v) => ({
      error: `${v.title}. ${v.reason}. ${v.nextAction}`,
    }),
  },
  "next/server": { NextResponse: { json: (v, o) => Response.json(v, o) } },
};
const access = compile("lib/call-coaching-access.ts", common);
assert.equal(access.coachingOwner(scope, sharon), cam);
assert.equal(await access.loadCoachingCall(callId, scope), null);
assert.equal(
  (await access.loadCoachingCall(callId, { ...scope, role: "owner" })).owner_id,
  sharon,
);
assert.equal(
  await access.loadCoachingCall(callId, {
    ...scope,
    role: "owner",
    workspaceId: otherWorkspace,
  }),
  null,
);
const planRoute = compile("app/api/interview/sales-plan/route.ts", {
  ...common,
  "@/lib/assigned-client-access": {
    loadAssignedClientAccess: async () => (clientAllowed ? {} : null),
  },
  "@/lib/sales-call-script": script,
});
const request = (body) => ({ json: async () => body });
const save = {
  key: "draft:unscheduled",
  prep: { brief: "Call intent" },
  products: ["adam"],
  expectedUpdatedAt: null,
};
const pitchContext = { companyId: callId, upcomingId: "upcoming-a", workstreamId: "project-a" };
const pitch = script.normaliseAdamPitch({ steps: script.ADAM_SCRIPT.steps.map(step => ({
  id: step.id, questions: step.questions.map(q => `For Acme, ${q}`),
})) }, script.adamPitchContextKey(pitchContext));
const pitchSave = { ...save, ...pitchContext, key: "draft:upcoming-a", prep: { salesScript: pitch } };
assert.equal((await planRoute.POST(request(pitchSave))).status, 200);
const getPitch = () => planRoute.GET({ nextUrl: new URL(`https://test/api?key=draft:upcoming-a&companyId=${callId}`) });
let pitchRead = await (await getPitch()).json();
assert.deepEqual(pitchRead.plan.prep.salesScript, plain(pitch), "Refresh returns the exact saved nine prompts");
assert.deepEqual(pitchRead.plan.script_snapshot.steps[0].questions, plain(pitch.steps[0].questions));
const camScope = scope;
scope = { ...camScope, userId: sharon };
assert.equal((await (await getPitch()).json()).plan, null, "Another sales user cannot read Cam's private pitch");
scope = { ...camScope, workspaceId: otherWorkspace };
assert.equal((await (await getPitch()).json()).plan, null, "Another workspace cannot read Cam's private pitch");
scope = { ...camScope, status: "inactive" };
assert.equal((await getPitch()).status, 403);
assert.equal((await planRoute.POST(request(pitchSave))).status, 403);
scope = camScope;
assert.equal((await planRoute.POST(request({ ...pitchSave, key: "draft:other-call", upcomingId: "other-call" }))).status, 200);
const mismatch = rows.call_script_plans.find(row => row.context_key === "draft:other-call");
assert.deepEqual(plain(mismatch.script_snapshot.steps[0].questions), plain(script.ADAM_SCRIPT.steps[0].questions), "A mismatched call never enters the coaching snapshot");
rows.call_script_plans.push({ workspace_id: workspace, owner_id: cam, context_key: "session:lc-oldcall", session_id: "lc-oldcall",
  script_snapshot: script.ADAM_SCRIPT_V2, updated_at: "old-version", timeline: [] });
assert.equal((await planRoute.POST(request({ ...pitchSave, key: "session:lc-oldcall", sessionId: "lc-oldcall", stage: "discovery", expectedUpdatedAt: "old-version" }))).status, 200);
const legacy = rows.call_script_plans.find(row => row.context_key === "session:lc-oldcall");
assert.equal(legacy.script_snapshot.version, script.ADAM_SCRIPT_V2.version);
assert.equal(legacy.stage, "discovery", "Historical calls keep the original script and stage");
let response = await planRoute.POST(request(save));
assert.equal(response.status, 200);
const saved = await response.json();
assert.equal(
  (await planRoute.POST(request(save))).status,
  409,
  "Stale saves cannot overwrite another version",
);
errorTable = "client_product_interests";
response = await planRoute.POST(
  request({
    ...save,
    expectedUpdatedAt: saved.updatedAt,
    companyId: callId,
    saveClientProducts: true,
  }),
);
assert.equal(response.status, 200);
const partial = await response.json();
assert.equal(partial.clientSaved, false);
assert.match(partial.notice, /preparation saved/);
errorTable = "";
clientAllowed = false;
assert.equal(
  (await planRoute.POST(request({ ...save, companyId: callId }))).status,
  404,
);
clientAllowed = true;
errorTable = "call_script_plans";
response = await planRoute.GET({
  nextUrl: new URL("https://test/api?key=draft:unscheduled"),
});
assert.equal(response.status, 500);
assert.doesNotMatch(JSON.stringify(await response.json()), /private database/);
errorTable = "";
const coachingRoute = compile("app/api/crm/call-coaching/route.ts", {
  ...common,
  "@/lib/call-coaching-access": access,
  "@/lib/script-coaching-report": reportLib,
  "@/lib/openai": {
    openai: {
      messages: {
        create: async () => {
          modelCalls++;
          return {
            content: [{ type: "text", text: JSON.stringify(baseReport) }],
          };
        },
      },
    },
    OPENAI_MODEL_PRO: "fixture",
  },
  "@/lib/usage": { logModelUsage: async () => {} },
  "@/lib/speakers": { loadHostIdentityForUser: async () => ({ name: "Cam" }) },
  "@/lib/coaching-transcript": {
    hostSpeakingStats: () => ({ words: 50 }),
    buildStrategicCoachingTranscript: (t) => t,
  },
});
assert.equal((await coachingRoute.POST(request({ callId }))).status, 404);
assert.equal(
  (await coachingRoute.PATCH(request({ callId, note: "My correction" })))
    .status,
  403,
);
await coachingRoute.GET({
  nextUrl: new URL(`https://test/api?owner=${sharon}`),
});
assert.equal(
  modelCalls,
  0,
  "Reading reports, denied access and review notes never trigger analysis",
);
scope = { ...scope, role: "owner" };
assert.equal(
  (await coachingRoute.GET({ nextUrl: new URL("https://test/api") })).status,
  200,
);
assert.equal(modelCalls, 0);

// Valid manual analysis, an active lease, and saved-report reuse.
rows.interview_sessions.push({
  workspace_id: workspace,
  owner_id: sharon,
  session_id: "lc-sharoncall",
  transcript:
    transcript +
    "\nCam: " +
    "Useful prospect example and specific context. ".repeat(20),
});
rows.call_script_plans.push({
  workspace_id: workspace,
  owner_id: sharon,
  context_key: "session:lc-sharoncall",
  script_snapshot: script.ADAM_SCRIPT,
  timeline,
  prep: { brief: "Recruitment discussion" },
});
rows.script_call_coaching.push({
  workspace_id: workspace,
  owner_id: sharon,
  session_id: "lc-sharoncall",
  call_id: callId,
  state: "generating",
  updated_at: "2026-11-19T00:00:00Z",
  lease_until: new Date(Date.now() + 60000).toISOString(),
});
assert.equal((await coachingRoute.POST(request({ callId }))).status, 409);
assert.equal(
  modelCalls,
  0,
  "An active analysis lease prevents duplicate model charges",
);
rows.script_call_coaching[0].lease_until = "2020-01-01T00:00:00Z";
response = await coachingRoute.POST(request({ callId }));
assert.equal(response.status, 200);
assert.equal(modelCalls, 1);
assert.equal((await response.json()).report.score, 100);
assert.equal((await coachingRoute.POST(request({ callId }))).status, 200);
assert.equal(modelCalls, 1, "Opening ready coaching reuses the saved analysis");
assert.equal(
  (
    await coachingRoute.PATCH(
      request({ callId, note: "Prospect redirected the conversation" }),
    )
  ).status,
  200,
);

// Mount the actual hook. Test an immediate start before the draft debounce,
// local recovery after refresh, two profiles, and a failed-load retry.
const dom = new JSDOM('<div id="root"></div>', {
  url: "https://livecoach.test",
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
global.IS_REACT_ACT_ENVIRONMENT = true;
const storage = dom.window.localStorage;
let apiError = false,
  user = cam,
  state,
  hookProps = {
    room: "lc-fixturecall",
    companyId: null,
    upcomingId: null,
    live: false,
    ended: false,
    ready: true,
    prep: { brief: "Prepared intent" },
    transcript: "",
    hydrate: () => {},
  },
  writes = [];
const hook = compile(
  "hooks/useSalesCallPlan.ts",
  {
    "@/lib/sales-call-script": script,
    "@/lib/crm": {
      crmFetch: async (url, opts) => {
        if (opts?.method === "POST") {
          writes.push(JSON.parse(opts.body));
          return { updatedAt: new Date().toISOString(), clientSaved: true };
        }
        if (apiError) throw new Error("Connection interrupted");
        return {
          workspaceId: workspace,
          userId: user,
          products: [],
          plan: null,
          seedPlan: null,
        };
      },
    },
  },
  { localStorage: storage },
);
function Harness() {
  state = hook.useSalesCallPlan(hookProps);
  return React.createElement("div", null, state.status);
}
let root = createRoot(document.getElementById("root"));
const render = async () =>
  act(async () => {
    root.render(React.createElement(Harness));
    await new Promise((r) => setTimeout(r, 5));
  });
await render();
await act(async () => {
  state.choose(["adam", "recruitment"]);
  state.setStage("demo");
  assert.equal(state.scriptRef.current.stage, "demo", "An immediate live cue receives the new section without waiting for a render");
});
hookProps = { ...hookProps, live: true };
await render();
assert.deepEqual(
  plain(state.products),
  ["adam", "recruitment"],
  "An immediate call start preserves a selection before server debounce",
);
await act(async () => {
  await new Promise((r) => setTimeout(r, 180));
});
assert.deepEqual(writes.at(-1).products, ["adam", "recruitment"]);
assert.equal(writes.at(-1).key, "session:lc-fixturecall");
await act(async () => root.unmount());
root = createRoot(document.getElementById("root"));
hookProps = { ...hookProps, live: false };
await render();
assert.deepEqual(
  plain(state.products),
  ["adam", "recruitment"],
  "Refresh restores the profile-specific local draft",
);
await act(async () => root.unmount());
user = sharon;
root = createRoot(document.getElementById("root"));
await render();
assert.deepEqual(
  plain(state.products),
  [],
  "Another profile cannot hydrate Cam’s local cache",
);
await act(async () => root.unmount());
apiError = true;
root = createRoot(document.getElementById("root"));
await render();
assert.equal(state.ready, false);
apiError = false;
await act(async () => {
  state.retry();
  await new Promise((r) => setTimeout(r, 5));
});
assert.equal(
  state.ready,
  true,
  "Load recovery actually reloads rather than silently skipping a save",
);
await act(async () => root.unmount());
let clicked = 0;
const button = compile("components/GetCallCoaching.tsx", {
  "@/lib/crm": {
    crmFetch: async () => {
      clicked++;
      return { ok: true, report: redirected, callId };
    },
  },
  "@/components/ScriptCoachingReport": () => null,
  "next/link": ({ children }) => React.createElement("span", null, children),
}).default;
root = createRoot(document.getElementById("root"));
await act(async () => {
  root.render(React.createElement(button, { sessionId: "lc-fixturecall" }));
});
assert.equal(
  clicked,
  0,
  "Displaying a post-call summary does not start coaching",
);
await act(async () => {
  document.querySelector("button").click();
  await new Promise((r) => setTimeout(r, 5));
});
assert.equal(
  clicked,
  1,
  "The Get coaching button runs the analysis explicitly",
);
await act(async () => root.unmount());
// Exercise the real product controls and private/owner report page.
const panel = compile("components/SalesScriptPanel.tsx", {
  "@/lib/sales-call-script": script,
}).default;
let chosen = [],
  selectedStage = "";
root = createRoot(document.getElementById("root"));
await act(async () => {
  root.render(
    React.createElement(panel, {
      products: ["adam"],
      onChange: (v) => (chosen = v),
      stage: "hook",
      onStage: (v) => (selectedStage = v),
      status: "Saved",
      ready: true,
      improvement: "",
      onRetry: () => {},
    }),
  );
});
await act(async () =>
  document.querySelectorAll("input[type=checkbox]")[1].click(),
);
assert.deepEqual(plain(chosen), ["adam", "recruitment"]);
await act(async () =>
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent.endsWith(script.ADAM_SCRIPT.steps[1].title))
    .click(),
);
assert.equal(selectedStage, "demo");
assert.equal(document.querySelectorAll('[aria-label="Script stage"] button').length, 3);
assert.equal(document.querySelectorAll('ol li').length, 3);
let prepareClicks = 0;
for (const stage of ["listen", "demo", "close"]) {
  await act(async () => root.render(React.createElement(panel, {
    products: ["adam"], onChange: () => {}, stage, onStage: value => { selectedStage = value; },
    status: "Saved", ready: true, improvement: "", onRetry: () => {},
    pitch, contextKey: script.adamPitchContextKey(pitchContext), onPrepare: () => prepareClicks++,
  })));
  assert.equal(document.querySelectorAll('ol li').length, 3);
  assert.ok([...document.querySelectorAll('ol li')].every(li => li.textContent.includes("For Acme")));
  assert.match(document.body.textContent, /Tailored to this call/);
  await act(async () => document.querySelector('[aria-label="Script stage"] button').click());
  assert.equal(prepareClicks, 0, "Changing section must not run paid preparation");
}
await act(async () => root.render(React.createElement(panel, {
  products: ["adam"], onChange: () => {}, stage: "listen", onStage: () => {},
  status: "Saved", ready: true, improvement: "", onRetry: () => {},
  pitch, contextKey: "another-client", live: true,
})));
assert.doesNotMatch(document.body.textContent, /For Acme/);
assert.match(document.body.textContent, /Starter prompts/);
assert.equal(document.querySelectorAll('ol li').length, 3);
await act(async () => root.unmount());
let ownerPage = false,
  queueReads = [],
  exports = 0;
const uiData = () => ({
  ownerView: ownerPage,
  team: [
    { id: cam, name: "Cam" },
    { id: sharon, name: "Sharon" },
  ],
  calls: [
    {
      callId,
      ownerId: cam,
      ownerName: "Cam",
      sessionId: "lc-fixturecall",
      title: "Plumbing demo",
      createdAt: new Date().toISOString(),
      state: "ready",
      report: redirected,
    },
  ],
  weekly: {
    totalCalls: 1,
    analysedCalls: 1,
    awaitingCoaching: 0,
    repeatedGaps: [],
    priorities: [],
  },
});
const page = compile(
  "app/crm/call-coach/page.tsx",
  {
    "@/lib/crm": {
      crmFetch: async (url) => {
        queueReads.push(url);
        return uiData();
      },
    },
    "@/components/crm/NavMenu": () => null,
    "@/components/ScriptCoachingReport": () => null,
    "next/link": ({ children }) => React.createElement("span", null, children),
  },
  {
    document: dom.window.document,
    Blob: dom.window.Blob,
    URL: {
      createObjectURL: () => {
        exports++;
        return "blob:fixture";
      },
      revokeObjectURL: () => {},
    },
  },
).default;
dom.window.HTMLAnchorElement.prototype.click = () => {};
for (const mode of [false, true]) {
  ownerPage = mode;
  root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(page));
    await new Promise((r) => setTimeout(r, 5));
  });
  const selector = document.querySelector(
    'select[aria-label="Salesperson coaching reports"]',
  );
  assert.equal(
    !!selector,
    mode,
    "Only the owner receives a team report selector",
  );
  if (mode) {
    await act(async () => {
      selector.value = cam;
      selector.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 5));
    });
    assert.match(queueReads.at(-1), new RegExp("owner=" + cam));
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "Export coaching report")
        .click(),
    );
    assert.equal(exports, 1);
  }
  await act(async () => root.unmount());
}
dom.window.close();
console.log(
  "Script selection, immediate start and refresh recovery, profile isolation, PostgreSQL RLS, redirect fairness, quote grounding, weekly patterns, route access, conflicts, partial saves, read errors and manual-only analysis passed",
);
