import {
  OPEN_PIPELINE_STAGES,
  opportunityHygieneError,
  pipelineStatusForStage,
  type OpenPipelineStage,
} from "@/lib/pipeline-entry";

export const PIPELINE_STAGE_DROP_PREFIX = "pipeline-stage:";

export type PipelineStageMove = {
  id: string;
  pipeline_stage: string;
  value: number | null;
};

export type PipelineStageMovePayload = {
  status: "open" | "won" | "lost";
  pipelineStage: OpenPipelineStage;
  sourceType: "human";
  sourceChannel: "pipeline_kanban_drag";
  rationale: string;
  evidence: {
    interaction: "drag_drop";
    fromStage: string;
    toStage: OpenPipelineStage;
  };
};

export function pipelineStageDropId(stage: string): string {
  return `${PIPELINE_STAGE_DROP_PREFIX}${stage}`;
}

export function pipelineStageFromDropId(value: unknown): OpenPipelineStage | null {
  const id = String(value || "");
  if (!id.startsWith(PIPELINE_STAGE_DROP_PREFIX)) return null;
  const stage = id.slice(PIPELINE_STAGE_DROP_PREFIX.length);
  return OPEN_PIPELINE_STAGES.includes(stage as OpenPipelineStage)
    ? (stage as OpenPipelineStage)
    : null;
}

export function preparePipelineStageMove(
  row: PipelineStageMove,
  targetStage: unknown
):
  | { ok: true; payload: PipelineStageMovePayload }
  | { ok: false; error: string } {
  if (!OPEN_PIPELINE_STAGES.includes(targetStage as OpenPipelineStage)) {
    return { ok: false, error: "Choose a valid open pipeline stage" };
  }
  const pipelineStage = targetStage as OpenPipelineStage;
  const hygieneError = opportunityHygieneError({
    pipelineStage,
    value: row.value,
  });
  if (hygieneError) return { ok: false, error: hygieneError };
  return {
    ok: true,
    payload: {
      status: pipelineStatusForStage(pipelineStage),
      pipelineStage,
      sourceType: "human",
      sourceChannel: "pipeline_kanban_drag",
      rationale: `Moved from ${row.pipeline_stage || "unknown"} to ${pipelineStage} on the pipeline board`,
      evidence: {
        interaction: "drag_drop",
        fromStage: row.pipeline_stage || "unknown",
        toStage: pipelineStage,
      },
    },
  };
}
