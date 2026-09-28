export const OPEN_PIPELINE_STAGES = ["new", "discovery", "qualified", "proposal", "negotiation", "verbal"] as const;
export type OpenPipelineStage = typeof OPEN_PIPELINE_STAGES[number];

export const QUALIFIED_PIPELINE_STAGES = [
  "qualified",
  "proposal",
  "negotiation",
  "verbal",
  "won",
] as const;

export const NOT_SUITABLE_OUTCOME = "not_suitable" as const;

export function isQualifiedPipelineStage(stage: unknown): boolean {
  return QUALIFIED_PIPELINE_STAGES.includes(
    String(stage || "").trim().toLowerCase() as typeof QUALIFIED_PIPELINE_STAGES[number]
  );
}

export function hasRecordedRevenueAmount(value: unknown): boolean {
  const amount = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(amount) && amount > 0;
}

export function opportunityHygieneError(input: {
  pipelineStage: unknown;
  value: unknown;
  outcomeReason?: unknown;
}): string | null {
  const stage = String(input.pipelineStage || "").trim().toLowerCase();
  if (stage === NOT_SUITABLE_OUTCOME) {
    const reason = typeof input.outcomeReason === "string"
      ? input.outcomeReason.trim()
      : "";
    return reason.length >= 10
      ? null
      : "Add a specific reason for marking this opportunity Not suitable so the team can learn from it";
  }
  if (isQualifiedPipelineStage(stage) && !hasRecordedRevenueAmount(input.value)) {
    return "Add a realistic expected revenue amount before moving this opportunity to Qualified or beyond";
  }
  return null;
}

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
  const hygieneError = opportunityHygieneError({ pipelineStage, value });
  if (hygieneError) return { ok: false, error: hygieneError };
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
