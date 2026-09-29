import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

import * as pipelineEntry from "../lib/pipeline-entry.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const source = readFileSync(path.join(root, "lib/pipeline-stage-drag.ts"), "utf8");
const module = { exports: {} };
new Function("require", "module", "exports", ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText)(
  (name) => name === "@/lib/pipeline-entry" ? pipelineEntry : require(name),
  module,
  module.exports
);

const {
  pipelineStageDropId,
  pipelineStageFromDropId,
  preparePipelineStageMove,
} = module.exports;

assert.equal(pipelineStageDropId("proposal"), "pipeline-stage:proposal");
assert.equal(pipelineStageFromDropId("pipeline-stage:negotiation"), "negotiation");
assert.equal(pipelineStageFromDropId("pipeline-stage:won"), null);
assert.equal(pipelineStageFromDropId("other:proposal"), null);

const prepared = preparePipelineStageMove(
  { id: "deal-1", pipeline_stage: "discovery", value: 5000 },
  "proposal"
);
assert.equal(prepared.ok, true);
assert.equal(prepared.payload.pipelineStage, "proposal");
assert.equal(prepared.payload.status, "open");
assert.equal(prepared.payload.sourceChannel, "pipeline_kanban_drag");
assert.deepEqual(prepared.payload.evidence, {
  interaction: "drag_drop",
  fromStage: "discovery",
  toStage: "proposal",
});

const missingValue = preparePipelineStageMove(
  { id: "deal-2", pipeline_stage: "discovery", value: null },
  "qualified"
);
assert.equal(missingValue.ok, false);
assert.match(missingValue.error, /expected revenue/i);
assert.equal(
  preparePipelineStageMove(
    { id: "deal-3", pipeline_stage: "verbal", value: 9000 },
    "won"
  ).ok,
  false
);

const component = readFileSync(
  path.join(root, "components/crm/PipelineWorkspace.tsx"),
  "utf8"
);
const page = readFileSync(path.join(root, "app/crm/revenue/page.tsx"), "utf8");
const route = readFileSync(
  path.join(root, "app/api/crm/opportunities/[id]/route.ts"),
  "utf8"
);

for (const pattern of [
  /DndContext/,
  /DragOverlay/,
  /useDraggable/,
  /useDroppable/,
  /pipelineKeyboardCoordinates/,
  /KeyboardCode\.Left, KeyboardCode\.Right/,
  /activationConstraint:\s*\{\s*delay:\s*180,\s*tolerance:\s*8\s*\}/,
  /Hold and drag to move/,
  /onStageMove\(row, targetStage\)/,
]) assert.match(component, pattern);
assert.doesNotMatch(component, /sortableKeyboardCoordinates/);

assert.match(page, /preparePipelineStageMove\(row, targetStage\)/);
assert.match(page, /saved\.pipeline_stage !== prepared\.payload\.pipelineStage/);
assert.match(page, /updateRow\(row\.id, \{ pipeline_stage: previousStage \}\)/);
assert.match(route, /patch\.pipeline_stage_override = true/);

console.log("Pipeline drag-and-drop validation passed");
