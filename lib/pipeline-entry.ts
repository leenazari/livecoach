export const OPEN_PIPELINE_STAGES = ["new", "discovery", "qualified", "proposal", "negotiation", "verbal"] as const;
export type OpenPipelineStage = typeof OPEN_PIPELINE_STAGES[number];

// Blank values stay unknown; only amounts explicitly entered by the user are saved.
export function parsePipelineEntry(body: unknown):
  | { ok: true; value: number | null; pipelineStage: OpenPipelineStage }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false, error: "Provide an opportunity object" };
  const input = body as Record<string, unknown>;
  const value = input.value == null ? null : input.value;
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0))
    return { ok: false, error: "Deal value must be a non-negative number, or left blank" };
  const pipelineStage = input.pipelineStage ?? "new";
  if (!OPEN_PIPELINE_STAGES.includes(pipelineStage as OpenPipelineStage))
    return { ok: false, error: "Choose an open sales stage" };
  return { ok: true, value: value as number | null, pipelineStage: pipelineStage as OpenPipelineStage };
}

export function pipelineStatusForStage(stage: string): "open" | "won" | "lost" {
  return stage === "won" ? "won" : stage === "lost" ? "lost" : "open";
}

export function summarizePipelineStages(
  rows: { pipeline_stage?: string | null; value?: number | null; status?: string; opportunity_type?: string }[],
  stages: { key: string; label: string }[],
) {
  return stages.filter((stage) => OPEN_PIPELINE_STAGES.includes(stage.key as OpenPipelineStage)).map((stage) => {
    const members = rows.filter((row) => row.pipeline_stage === stage.key
      && (!row.status || row.status === "open")
      && (!row.opportunity_type || row.opportunity_type === "revenue"));
    return { ...stage, count: members.length, value: members.reduce((sum, row) => sum + (Number.isFinite(row.value) ? Math.max(0, row.value!) : 0), 0) };
  });
}
