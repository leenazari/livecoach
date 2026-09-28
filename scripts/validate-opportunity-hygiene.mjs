import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasRecordedRevenueAmount,
  isQualifiedPipelineStage,
  NOT_SUITABLE_OUTCOME,
  opportunityHygieneError,
} from "../lib/pipeline-entry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

for (const stage of ["qualified", "proposal", "negotiation", "verbal", "won"])
  assert.equal(isQualifiedPipelineStage(stage), true, `${stage} should count as qualified`);
for (const stage of ["new", "discovery", "lost", NOT_SUITABLE_OUTCOME])
  assert.equal(isQualifiedPipelineStage(stage), false, `${stage} should not count as qualified`);

assert.equal(hasRecordedRevenueAmount(1), true);
assert.equal(hasRecordedRevenueAmount(0), false);
assert.match(
  opportunityHygieneError({ pipelineStage: "proposal", value: null }) || "",
  /revenue amount/i
);
assert.match(
  opportunityHygieneError({
    pipelineStage: NOT_SUITABLE_OUTCOME,
    value: null,
    outcomeReason: "No",
  }) || "",
  /specific reason/i
);
assert.equal(
  opportunityHygieneError({
    pipelineStage: NOT_SUITABLE_OUTCOME,
    value: null,
    outcomeReason: "No active hiring need in the next twelve months",
  }),
  null
);

const editor = read("components/crm/PipelineWorkspace.tsx");
const create = read("components/crm/NewPipelineOpportunity.tsx");
const revenuePage = read("app/crm/revenue/page.tsx");
const revenueApi = read("app/api/crm/revenue/route.ts");
const opportunityApi = read("app/api/crm/opportunities/[id]/route.ts");
const postCall = read("components/crm/PostCallDealUpdate.tsx");
const postCallApi = read("app/api/crm/calls/[id]/commercial-update/route.ts");

assert.match(editor, /Expected revenue is required at Qualified and later stages/);
assert.match(editor, /Revenue needed/);
assert.match(editor, /missing_value/);
assert.match(editor, /Why is this opportunity not suitable/);
assert.match(editor, /draggable=\{editable && !busy\}/);
assert.match(editor, /onDrop=\{\(event\) => void dropOnStage\(event, stage\.key\)\}/);
assert.match(editor, /await onSave\(\{ \.\.\.row, pipeline_stage: targetStage \}\)/);
assert.match(editor, /Add expected revenue before moving this opportunity/);
assert.match(editor, /On touch devices, open the opportunity and choose its stage/);
assert.match(create, /Qualified and later stages need a positive revenue amount/);
assert.match(revenuePage, /outcomeDisposition: notSuitable \? NOT_SUITABLE_OUTCOME/);
assert.match(revenuePage, /return true/);
assert.match(revenuePage, /return false/);
assert.match(revenueApi, /qualified: isQualifiedPipelineStage\(op\.pipeline_stage\)/);
assert.match(revenueApi, /valueRecorded/);

assert.match(opportunityApi, /body\.outcomeDisposition === NOT_SUITABLE_OUTCOME/);
assert.match(opportunityApi, /patch\.outcome_reason = body\.outcomeReason/);
assert.match(opportunityApi, /\.eq\("workspace_id", account\.workspaceId\)/);
assert.match(opportunityApi, /loadVisibleOpportunityById/);

assert.match(postCall, /outcomeDisposition: stage === NOT_SUITABLE_OUTCOME/);
assert.match(postCallApi, /notSuitableRequested/);
assert.match(postCallApi, /outcome_reason: notSuitableRequested/);
assert.match(postCallApi, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(postCallApi, /assigned_to_user_id\.eq\.\$\{scope\.userId\}/);

console.log("Opportunity revenue prompts, qualification rules, reason capture and access scoping passed");
