import { z } from "zod";
import { ADAM_SCRIPT, coachingScore } from "./sales-call-script";
export const CoachingReportSchema = z.object({
  headline: z.string().max(500),
  strengths: z.array(z.string().max(700)).max(5),
  improvements: z.array(z.string().max(900)).max(2),
  nextCallFocus: z.string().max(700),
  intentOutcome: z.string().max(1400),
  switchReview: z.string().max(1400),
  criteria: z
    .array(
      z.object({
        product: z.enum(["adam", "recruitment", "training", "other"]),
        stageId: z.string().max(80),
        status: z.enum([
          "met",
          "partial",
          "missed",
          "not_applicable",
          "unverifiable",
        ]),
        evidenceQuote: z.string().max(600),
        explanation: z.string().max(1000),
        betterNextTime: z.string().max(1000),
      }),
    )
    .max(25),
});
export type ScriptCoachingReport = z.infer<typeof CoachingReportSchema> & {
  score: number | null;
  generatedAt: string;
  scriptVersion: string | null;
  limits: string[];
};
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function groundedReport(
  input: unknown,
  transcript: string,
  snapshot: any,
  timeline: any[] = [],
): ScriptCoachingReport {
  const parsed = CoachingReportSchema.parse(input);
  const text = normalise(transcript);
  const hasApproved =
    snapshot?.version === ADAM_SCRIPT.version ||
    (typeof snapshot?.version === "string" && Array.isArray(snapshot.steps));
  const ids = new Set(
    (hasApproved ? snapshot.steps : []).map((s: any) => s.id),
  );
  const adamActive =
    !timeline.length ||
    timeline.some((change) => change.products?.includes("adam"));
  const redirected =
    timeline.some((change) => change.products?.includes("adam")) &&
    !timeline.at(-1)?.products?.includes("adam");
  const seen = new Set<string>();
  const criteria = parsed.criteria
    .filter((c) => {
      const id = `${c.product}:${c.stageId}`;
      if (
        !adamActive ||
        c.product !== "adam" ||
        !ids.has(c.stageId) ||
        seen.has(id)
      )
        return false;
      seen.add(id);
      return true;
    })
    .map((c) => {
      if (redirected && c.status === "missed")
        return {
          ...c,
          status: "not_applicable" as const,
          explanation:
            "The product focus changed during this call. Uncompleted sections are excluded from the score; review the transcript and change log for context.",
        };
      const quote = normalise(c.evidenceQuote);
      if (
        (quote && !text.includes(quote)) ||
        (["met", "partial"].includes(c.status) && quote.length < 10)
      )
        return {
          ...c,
          status: "unverifiable" as const,
          evidenceQuote: "",
          explanation:
            "The recording does not provide a reliable quote for this assessment.",
          betterNextTime: c.betterNextTime,
        };
      return c;
    });
  return {
    ...parsed,
    criteria,
    score: coachingScore(criteria),
    generatedAt: new Date().toISOString(),
    scriptVersion: hasApproved ? snapshot.version : null,
    limits: [
      "Transcript evidence cannot verify a screen share or visual demonstration.",
      ...(!hasApproved
        ? [
            "No approved product script was saved for this call; feedback uses its intent and focus, with no script score.",
          ]
        : []),
    ],
  };
}
export function weeklyCoaching(calls: any[]) {
  const analysed = calls.filter((c) => c.report);
  const patterns = new Map<
    string,
    { stage: string; misses: number; people: Set<string> }
  >();
  for (const call of analysed)
    for (const criterion of call.report.criteria || []) {
      if (!["missed", "partial"].includes(criterion.status)) continue;
      const key = `${criterion.product}:${criterion.stageId}`;
      const value = patterns.get(key) || {
        stage: criterion.stageId,
        misses: 0,
        people: new Set<string>(),
      };
      value.misses++;
      value.people.add(call.ownerId);
      patterns.set(key, value);
    }
  return {
    totalCalls: calls.length,
    analysedCalls: analysed.length,
    awaitingCoaching: calls.length - analysed.length,
    repeatedGaps: [...patterns.values()]
      .filter((v) => v.misses >= 2)
      .map((v) => ({
        stage: v.stage,
        occurrences: v.misses,
        acrossSalespeople: v.people.size,
        reviewScript: v.people.size >= 2,
      })),
    priorities: analysed
      .map((c) => ({
        callId: c.callId,
        salesperson: c.ownerName,
        focus: c.report.nextCallFocus,
      }))
      .slice(0, 20),
  };
}
