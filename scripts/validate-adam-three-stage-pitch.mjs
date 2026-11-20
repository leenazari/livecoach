import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as script from "../lib/sales-call-script.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const context = { upcomingId: "call-a", companyId: "company-a", workstreamId: "project-a" };
const key = script.adamPitchContextKey(context);
const rawPitch = { steps: script.ADAM_SCRIPT.steps.map(step => ({
  id: step.id, questions: step.questions.map(question => `For Acme, ${question}`),
})) };
const pitch = script.normaliseAdamPitch(rawPitch, key);
assert.equal(pitch.personalised, true);
assert.deepEqual(pitch.steps.map(step => step.stage), ["Listen & ask", "Demo", "Close & next steps"]);
assert.ok(pitch.steps.every(step => step.questions.length === 3));
assert.deepEqual(script.savedAdamPitch(pitch, key), pitch);
for (const field of ["upcomingId", "companyId", "workstreamId"]) {
  assert.equal(script.savedAdamPitch(pitch, script.adamPitchContextKey({ ...context, [field]: "other" })), null);
}
assert.equal(script.savedAdamPitch({ ...pitch, version: script.ADAM_SCRIPT_V2.version }, key), null);
for (const invalid of [null, [], ["Too short"], ["A repeated question?", "A repeated question?", "A repeated question?"],
  ["One valid question?", "Second valid question?", "Third valid question?", "An unwanted extra question?"],
  ["x".repeat(321), "Second valid question?", "Third valid question?"], [1, 2, 3]]) {
  const result = script.normaliseAdamPitch({ steps: [{ id: "listen", questions: invalid }, ...rawPitch.steps.slice(1)] }, key);
  assert.equal(result.personalised, false, "Malformed output must never be labelled tailored");
  assert.deepEqual(result.steps[0].questions, script.ADAM_SCRIPT.steps[0].questions);
}
const reordered = script.normaliseAdamPitch({ steps: [...rawPitch.steps].reverse().concat({ id: "extra", questions: ["ignored"] }) }, key);
assert.deepEqual(reordered.steps.map(step => step.id), ["listen", "demo", "close"]);
assert.match(script.scriptContext(["adam"], "demo"), /Current host-selected stage: demo/);
assert.match(script.scriptContext(["adam"], "close"), /Live cues are optional follow-ups/);
assert.match(script.ADAM_PITCH_GENERATION, /action, owner, date and purpose/);
const callPage = read("app/call/page.tsx");
assert.match(callPage, /adaptiveSalesScriptRef\.current = salesScript\?\.version \? "" : script/, "An Adam pitch cannot leak into a different product's generic script");
assert.equal((callPage.match(/products\.includes\("adam"\) \? adamSalesScriptRef\.current : adaptiveSalesScriptRef\.current/g) || []).length, 2, "Both live cue routes receive the selected product's matching script");

// Execute the real preparation route with deterministic model responses. No
// external model, live database, transcript fetch or paid generation is used.
let output = {}, calls = [], persisted = [], denied = false, rejectModel = false;
const background = [];
class FocusPersistenceError extends Error {
  status = 404;
  code = "focus_call_not_found";
  nextAction = "Open a call available to your account";
}
const deps = {
  "next/server": { NextResponse: { json: (body, opts) => Response.json(body, opts) } },
  "@vercel/functions": { waitUntil: task => background.push(task) },
  "@/lib/openai": {
    OPENAI_MODEL_LIVE: "structural", OPENAI_MODEL_PRO: "pitch",
    openai: { messages: { create: async request => {
      calls.push(request);
      if (rejectModel) throw new Error("Test model unavailable");
      return { content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 100, output_tokens: 200 } };
    } } },
  },
  "@/lib/workspace": { workspaceContextBlock: async () => "", getLessonsBlock: async () => "", getRelevantPitchingLessons: async () => "" },
  "@/lib/supabase": { supabaseAdmin: { from: table => {
    assert.equal(table, "companies", "No transcript or unrelated CRM query");
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }) };
    return query;
  } } },
  "@/lib/record-scope": { resolveRecordScope: async () => ({ workspaceId: "workspace-a", userId: "owner-a" }) },
  "@/lib/call-focus-persistence": {
    FocusPersistenceError,
    verifyFocusBuildTarget: async (scope, id) => {
      assert.equal(scope.userId, "owner-a");
      assert.equal(id, context.upcomingId);
      if (denied) throw new FocusPersistenceError("This call is not available to your account");
      return { company_id: context.companyId };
    },
    persistFocusBuild: async input => {
      persisted.push(input);
      return { suggestedFocus: input.result.focusAreas || [], selectedFocus: [], added: 0, upgraded: 0 };
    },
  },
  "@/lib/crm-blocker": { crmBlockerPayload: value => value },
  "@/lib/sales-call-script": script,
};
const exports = {};
vm.runInNewContext(ts.transpileModule(read("app/api/interview/plan/route.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, Response, Date, Set, AbortController, setTimeout, clearTimeout,
  console: { error() {} }, require: name => { assert.ok(name in deps, name); return deps[name]; },
});
async function run(extra = {}) {
  calls = []; persisted = [];
  const response = await exports.POST({ json: async () => ({
    ...context, salesProducts: ["adam"], brief: "Explore Adam for Acme's inbound enquiries",
    knowledgeContext: "Acme supplies plumbing services. Its site has an enquiry form. No drop-off rate is known.",
    focusOnly: true, ...extra,
  }) });
  await Promise.all(background.splice(0));
  return { status: response.status, body: await response.json() };
}
output = { focusAreas: ["Understand Acme's customer journey", "Agree a useful next step"],
  callType: "sales", salesScript: rawPitch, additions: ["Explore the enquiry form"], upgrades: [] };
for (const extra of [{}, { focusBuildMode: "refocus", existingFocus: ["Understand the journey"] }]) {
  const result = await run(extra);
  assert.equal(result.status, 200);
  assert.equal(result.body.salesScript.contextKey, key);
  assert.equal(result.body.salesScript.personalised, true);
  assert.equal(calls.length, 1, "Nine prompts reuse the existing focus model call");
  assert.match(calls[0].system, /exactly three steps/);
  assert.match(calls[0].messages[0].content, /Acme supplies plumbing services/);
  assert.deepEqual(JSON.parse(JSON.stringify(persisted[0].result.salesScript)), result.body.salesScript, "Prompts persist alongside focus on the server");
}
let result = await run({ focusOnly: false });
assert.equal(result.body.salesScript.personalised, true);
assert.equal(calls.length, 2, "Full plan uses its existing structural and pitch calls only");
assert.match(JSON.stringify(calls[1].system), /exactly three steps/);
assert.doesNotMatch(JSON.stringify(calls[1].system), /exactly 5 ordered stages/);
result = await run({ salesProducts: ["training"] });
assert.equal(result.body.salesScript, undefined, "Other products are not given an Adam pitch");
assert.doesNotMatch(calls[0].system, /ADAM PITCH/);
result = await run({ companyId: "wrong-company" });
assert.equal(result.body.salesScript.contextKey, key, "The owned scheduled call is authoritative, not a stale posted company");
denied = true;
result = await run();
assert.equal(result.status, 404);
assert.equal(calls.length, 0, "An inaccessible call cannot trigger paid generation");
assert.equal(persisted.length, 0);
denied = false; rejectModel = true;
result = await run();
assert.equal(result.status, 200);
assert.equal(result.body.salesScript.personalised, false);
assert.ok(result.body.salesScript.steps.every(step => step.questions.length === 3));
assert.equal(calls.length, 1, "No automatic retry of a paid generation");

console.log("Adam three-section prompts, malformed-output fallback, exact client/call/project matching, focus/full generation, durable persistence handoff and denied-call cost safety passed");
