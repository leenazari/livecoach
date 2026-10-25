import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server.js";

const require = createRequire(import.meta.url);
function compile(file, replacements = {}, extra = "") {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(file, "utf8") + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)(name => {
    if (name in replacements) return replacements[name];
    if (name === "server-only" || name.startsWith("@/")) return {};
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const id = n => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const alice = id(1), bob = id(2), workspace = id(3), otherWorkspace = id(4), prospectId = id(5), campaignId = id(6);
const scope = { userId: alice, workspaceId: workspace, role: "sales", status: "active" };
const today = "2026-10-27";
const person = { id: prospectId, workspace_id: workspace, assigned_to_user_id: alice, first_name: "Example", last_name: "Prospect", research: { marker: "full-prospect" } };
const member = { id: id(7), workspace_id: workspace, owner_id: bob, prospect_id: prospectId, campaign_id: campaignId, queued_for: today, status: "queued", research: { marker: "full-enrolment" } };
const campaign = { id: campaignId, workspace_id: workspace, owner_id: bob, status: "active", voice: { marker: "full-campaign" } };
let db, failTable;
const reads = [];
const reset = () => { db = { outreach_prospects: [{ ...person }], outreach_enrolments: [{ ...member }], outreach_campaigns: [{ ...campaign }] }; };
reset();
const client = createClient("https://database.invalid", "test-only", { global: { fetch: async (input, init = {}) => {
  assert.ok(["GET", "HEAD"].includes(init.method || "GET"), "Preflight must never claim, enqueue, send or change data");
  const url = new URL(String(input)), params = url.searchParams, table = url.pathname.split("/").pop();
  reads.push({ table, url });
  if (table === failTable) return Response.json({ code: "READ_FAILED", message: "database unavailable" }, { status: 500 });
  let rows = (db[table] || []).filter(row => [...params].every(([key, value]) => {
    if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
    if (value.startsWith("ilike.")) return String(row[key] || "").toLowerCase() === value.slice(6).toLowerCase();
    if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
    return true;
  })).slice(0, Number(params.get("limit") || 1000));
  const fields = params.get("select");
  if (fields && fields !== "*") rows = rows.map(row => Object.fromEntries(fields.split(",").map(key => [key, row[key]])));
  return Response.json(rows);
} } });
const blockers = compile("lib/crm-blocker.ts");
const preparation = compile("lib/outreach-preparation.ts", { "@/lib/crm-blocker": blockers });
const queueRepair = compile("lib/outreach-queue-repair.ts");
const check = fullRecords => preparation.loadOutreachPreparation({ client, scope, prospectId, today, fullRecords });
let signatures = 0, generationHandoffs = 0;
const assistant = compile("app/api/crm/assistant/route.ts", {
  "@/lib/supabase": { supabaseAdmin: client },
  "@/lib/request-scope": { getRequestScope: () => scope },
  "@/lib/outreach": { londonDate: () => today },
  "@/lib/outreach-preparation": preparation,
  "@/lib/outreach-queue-repair": queueRepair,
  "@/lib/brain-authority": {
    brainAuthorityProfile: () => ({ requiresSeparateApproval: true, actionKind: "paid_generation", risk: "paid_generation" }),
    signBrainAction: () => { signatures++; return "test-execution-token"; },
  },
}, "\nexport { resolveActions, flagUnresolvedActions, authoriseResolvedActions };\n");
const prepare = compile("app/api/crm/outreach/[id]/prepare/route.ts", {
  "@/lib/supabase": { supabaseAdmin: client },
  "@/lib/outreach-identity": { resolveOutreachIdentity: async () => scope },
  "@/lib/outreach": { londonDate: () => today },
  "@/lib/outreach-preparation": preparation,
  "@/lib/outreach-queue-repair": queueRepair,
  "@/lib/workspace-profile": { ensureWorkspaceProfileId: async () => { generationHandoffs++; throw Error("READY_FOR_EXISTING_GENERATION"); } },
});
const requested = [{ type: "prepare_outreach", prospect: "Example Prospect", guidance: "Use saved facts" }];
const post = () => prepare.POST(new NextRequest(`https://crm.test/api/crm/outreach/${prospectId}/prepare`, {
  method: "POST", body: JSON.stringify({ generationMode: "manual" }),
}), { params: { id: prospectId } });

// A shared membership created by another salesperson remains valid for the
// actual assignee; minimal preflight and full execution reads agree.
let result = await check(false);
assert.equal(result.ok, true);
assert.equal(result.enrolment.id, member.id);
assert.equal(result.prospect.research, undefined, "Brain preflight avoids loading research bodies");
result = await check(true);
assert.equal(result.ok, true);
assert.deepEqual(result.prospect.research, person.research);
assert.deepEqual(result.enrolment.research, member.research);
assert.deepEqual(result.campaign.voice, campaign.voice);
let actions = await assistant.resolveActions(requested);
assert.equal(actions.length, 1);
assert.equal(actions[0].endpoint, `/api/crm/outreach/${prospectId}/prepare`);
assert.equal(actions[0].body.guidance, "Use saved facts");
assert.equal(assistant.authoriseResolvedActions(actions, scope, false)[0].executionToken, "test-execution-token");
assert.equal(signatures, 1);

const cases = [
  { change: () => { db.outreach_enrolments = []; }, status: 400, code: "outreach_prepare_queue_required", reason: /Add this prospect to today's Outreach queue/ },
  { change: () => { db.outreach_enrolments[0].queued_for = "2026-10-26"; }, status: 400, code: "outreach_prepare_queue_required" },
  { change: () => { db.outreach_enrolments[0].status = "approved"; }, status: 400, code: "outreach_prepare_queue_required" },
  { change: () => { db.outreach_enrolments.push({ ...member, id: id(8), campaign_id: id(9) }); }, status: 409, code: "outreach_prepare_duplicate_queue", reason: /Ask a manager/ },
  { change: () => { db.outreach_campaigns[0].status = "paused"; }, status: 400, code: "outreach_prepare_campaign_inactive", reason: /campaign owner/ },
  { change: () => { db.outreach_campaigns = []; }, status: 400, code: "outreach_prepare_campaign_inactive" },
  { change: () => { db.outreach_enrolments[0].workspace_id = otherWorkspace; }, status: 400, code: "outreach_prepare_queue_required" },
  { change: () => { db.outreach_campaigns[0].workspace_id = otherWorkspace; }, status: 400, code: "outreach_prepare_campaign_inactive" },
];
for (const test of cases) {
  reset(); test.change();
  const snapshot = JSON.stringify(db);
  actions = await assistant.resolveActions(requested);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].unavailable, true);
  assert.equal(actions[0].batchSafe, false);
  assert.equal(actions[0].endpoint, undefined);
  assert.equal(actions[0].blocker.code, test.code);
  if (test.reason) assert.match(actions[0].failureReason, test.reason);
  assert.deepEqual(assistant.flagUnresolvedActions(requested, actions), [], "No duplicate generic blocker card");
  const safe = assistant.authoriseResolvedActions(actions, scope, false);
  assert.equal(safe[0].executionToken, undefined, "Blocked actions cannot receive execution tokens");
  const response = await post();
  const payload = await response.json();
  assert.equal(response.status, test.status);
  assert.equal(payload.blocker.code, test.code, "Old action buttons get the same precise reason at execution time");
  assert.equal(payload.error, actions[0].failureReason);
  assert.equal(generationHandoffs, 0, "Prerequisites fail before profile/model work");
  assert.equal(JSON.stringify(db), snapshot);
}
assert.equal(signatures, 1);
for (const assigned of [null, bob]) {
  reset(); db.outreach_prospects[0].assigned_to_user_id = assigned;
  const response = await post();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).blocker.code, "outreach_prepare_assignment_required");
}
reset(); db.outreach_prospects[0].workspace_id = otherWorkspace;
assert.equal((await post()).status, 404);
for (const table of ["outreach_prospects", "outreach_enrolments", "outreach_campaigns"]) {
  reset(); failTable = table;
  await assert.rejects(() => check(false), error => error.code === "READ_FAILED", "Database errors cannot masquerade as missing queue entries");
}
failTable = undefined;
reset();
// Confirm valid requests reach the unchanged generation workflow. Its boundary
// is stubbed deliberately so this test cannot spend tokens or save a draft.
const originalError = console.error;
try {
  console.error = () => {};
  const response = await post();
  assert.equal((await response.json()).error, "READY_FOR_EXISTING_GENERATION");
  assert.equal(generationHandoffs, 1);
} finally { console.error = originalError; }
assert.ok(reads.every(({ url }) => url.searchParams.get("workspace_id") === `eq.${workspace}`));
assert.ok(reads.filter(({ table }) => table === "outreach_enrolments").every(({ url }) => !url.searchParams.has("owner_id")));
console.log("Brain preparation checks passed: shared validation, actionable blocked proposals, queue date/status, duplicates, inactive campaigns, stale buttons, tenant/assignment isolation and fail-closed reads. No live writes or model calls.");
