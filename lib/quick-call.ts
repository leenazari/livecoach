export const QUICK_CALL_OUTCOMES = [
  "connected",
  "voicemail",
  "no_answer",
  "wrong_contact",
] as const;

export type QuickCallOutcome = (typeof QUICK_CALL_OUTCOMES)[number];

export const QUICK_CALL_STAGES = [
  "new",
  "discovery",
  "qualified",
  "proposal",
  "negotiation",
  "verbal",
] as const;

export type QuickCallStage = (typeof QUICK_CALL_STAGES)[number];

export type QuickCallSuggestion = {
  pipelineStage: QuickCallStage;
  nextAction: string;
  nextActionOwner: "us" | "buyer" | "joint";
  dueInDays: number;
  rationale: string;
};

const clean = (value: unknown, max: number) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export function fallbackQuickCallSuggestion(args: {
  outcome: QuickCallOutcome;
  currentStage: string;
  currentNextAction?: string | null;
}): QuickCallSuggestion {
  const stage = QUICK_CALL_STAGES.includes(args.currentStage as QuickCallStage)
    ? (args.currentStage as QuickCallStage)
    : "new";

  if (args.outcome === "wrong_contact") {
    return {
      pipelineStage: stage,
      nextAction: "Find and contact the correct decision maker",
      nextActionOwner: "us",
      dueInDays: 1,
      rationale: "The person reached was not the correct contact",
    };
  }
  if (args.outcome === "voicemail") {
    return {
      pipelineStage: stage,
      nextAction: "Send a short follow up and call again",
      nextActionOwner: "us",
      dueInDays: 2,
      rationale: "A voicemail was left without a live conversation",
    };
  }
  if (args.outcome === "no_answer") {
    return {
      pipelineStage: stage,
      nextAction: "Call again at a different time",
      nextActionOwner: "us",
      dueInDays: 2,
      rationale: "The call was not answered",
    };
  }
  return {
    pipelineStage: stage,
    nextAction:
      clean(args.currentNextAction, 500) ||
      "Confirm the next mutual step from the conversation",
    nextActionOwner: "joint",
    dueInDays: 2,
    rationale: "The note was saved but a confident automatic update was unavailable",
  };
}

export function cleanQuickCallSuggestion(
  value: any,
  fallback: QuickCallSuggestion
): QuickCallSuggestion {
  const pipelineStage = QUICK_CALL_STAGES.includes(value?.pipelineStage)
    ? value.pipelineStage
    : fallback.pipelineStage;
  const nextActionOwner = ["us", "buyer", "joint"].includes(
    value?.nextActionOwner
  )
    ? value.nextActionOwner
    : fallback.nextActionOwner;
  const dueInDays = Math.max(
    0,
    Math.min(90, Math.round(Number(value?.dueInDays) || fallback.dueInDays))
  );
  return {
    pipelineStage,
    nextAction:
      clean(value?.nextAction, 500) || fallback.nextAction,
    nextActionOwner,
    dueInDays,
    rationale: clean(value?.rationale, 500) || fallback.rationale,
  };
}

export function dueDateFromDays(
  days: number,
  now = new Date()
): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.min(90, days)));
  return date.toISOString().slice(0, 10);
}
