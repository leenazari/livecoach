import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parsePipelineEntry, pipelineStatusForStage, summarizePipelineStages, OPEN_PIPELINE_STAGES } from "../lib/pipeline-entry.ts";
import { opportunityMatchesOwner } from "../lib/opportunity-owner-filter.ts";
import { activeCompanyPipelineExclusion } from "../lib/company-pipeline-exclusion.ts";

assert.deepEqual(parsePipelineEntry({}), { ok: true, value: null, pipelineStage: "new" });
assert.deepEqual(parsePipelineEntry({ value: 0, pipelineStage: "proposal" }), { ok: true, value: 0, pipelineStage: "proposal" });
assert.equal(parsePipelineEntry({ value: 12450.75 }).value, 12450.75);
for (const value of [-1, Infinity, NaN, "1000", {}, true]) assert.equal(parsePipelineEntry({ value }).ok, false);
for (const pipelineStage of ["won", "lost", "invented", false]) assert.equal(parsePipelineEntry({ pipelineStage }).ok, false);
for (const input of [null, [], "bad"]) assert.equal(parsePipelineEntry(input).ok, false);
assert.equal(pipelineStatusForStage("won"), "won");
assert.equal(pipelineStatusForStage("lost"), "lost");
for (const stage of OPEN_PIPELINE_STAGES) assert.equal(pipelineStatusForStage(stage), "open");

const stages = OPEN_PIPELINE_STAGES.map((key) => ({ key, label: key }));
const rows = [
  { owner_id: "me", pipeline_stage: "proposal", value: 12000.5, status: "open" },
  { owner_id: "me", pipeline_stage: "proposal", value: null },
  { owner_id: "someone", assigned_to_user_id: "me", pipeline_stage: "new", value: 3000 },
  { owner_id: "someone", pipeline_stage: "proposal", value: 90000 },
  { owner_id: "me", pipeline_stage: "proposal", value: 50000, status: "won" },
  { owner_id: "me", pipeline_stage: "proposal", value: 70000, opportunity_type: "investment" },
];
const totals = summarizePipelineStages(rows.filter((row) => opportunityMatchesOwner(row, "mine", "me")), stages);
assert.deepEqual(totals.find((s) => s.key === "proposal"), { key: "proposal", label: "proposal", count: 2, value: 12000.5 });
assert.equal(totals.find((s) => s.key === "new").value, 3000);
assert.equal(totals.find((s) => s.key === "verbal").count, 0);
assert.equal(totals.reduce((sum, s) => sum + s.count, 0), 3);
assert.equal(totals.reduce((sum, s) => sum + s.value, 0), 15000.5);

// Exercise the real POST with controlled storage and identity boundaries.
let allowed = true;
let excluded = false;
let created = true;
let draft;
let calls = 0;
const scope = { userId: "salesperson", workspaceId: "workspace" };
const existing = { id: "existing", pipeline_stage: "qualified", value: 888 };
const query = { select() { return this; }, eq() { return this; }, async maybeSingle() {
  return { data: { profile: excluded ? { pipeline_exclusion: { active: true } } : {} }, error: null };
} };
const dependencies = {
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  "@/lib/supabase": { supabaseAdmin: { from: () => query } },
  "@/lib/request-scope": { requireRequestScope: () => scope },
  "@/lib/opportunity-access": {},
  "@/lib/assigned-client-access": { loadAssignedClientAccess: async () => allowed ? { company: { id: "client", name: "Example", workspace_id: "workspace" } } : null },
  "@/lib/pipeline-entry": { parsePipelineEntry },
  "@/lib/company-pipeline-exclusion": { activeCompanyPipelineExclusion },
  "@/lib/canonical-opportunity": { createCanonicalOpenRevenueOpportunity: async (_company, input) => {
    calls++; draft = input;
    return { created, opportunity: created ? { id: "new", value: input.value, pipeline_stage: input.pipelineStage } : existing };
  } },
};
const source = readFileSync(new URL("../app/api/crm/companies/[id]/pipeline/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)((name) => {
  assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
}, module, module.exports);
const post = (body) => module.exports.POST({ json: async () => body }, { params: { id: "client" } });
allowed = false;
assert.equal((await post({ value: 500 })).status, 404);
assert.equal(calls, 0, "Unauthorised client cannot create an opportunity");
allowed = true;
assert.equal((await post({ value: -1 })).status, 400);
assert.equal((await post(null)).status, 400);
assert.equal(calls, 0);
excluded = true;
assert.equal((await post({ value: 500 })).status, 409);
assert.equal(calls, 0, "Explicit pipeline exclusions cannot be silently reversed");
excluded = false;
let response = await post({ title: "Support contract", value: 12500.25, pipelineStage: "proposal", assignedToUserId: "someone-else" });
assert.equal(response.status, 200);
assert.equal((await response.json()).opportunity.value, 12500.25);
assert.equal(draft.assignedToUserId, scope.userId, "Sales creation always assigns the signed-in user");
assert.equal(draft.pipelineStage, "proposal");
assert.equal(draft.probability, 0, "Creating a deal must not invent a win probability");
assert.equal(draft.surfacedByAi, false);
created = false;
response = await post({ value: 9999, pipelineStage: "verbal" });
assert.deepEqual(await response.json(), { opportunity: existing, created: false, alreadyPresent: true }, "Duplicate handling must preserve the existing deal's value and stage");
console.log("Pipeline entry, access boundaries, duplicate responses, stage outcomes and filtered totals passed.");
