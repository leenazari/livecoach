import "server-only";

import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { modelText, parseObject } from "@/lib/outreach";
import { supabaseAdmin } from "@/lib/supabase";
import { capitaliseSentenceStarts } from "@/lib/text";
import { logModelUsage } from "@/lib/usage";
import type { ManualOutreachCallOutcome } from "@/lib/outreach-manual-call-rules";

export {
  MANUAL_OUTREACH_CALL_LABELS,
  MANUAL_OUTREACH_CALL_OUTCOMES,
  defaultManualCallDueDays,
  defaultManualCallNextAction,
  manualCallNextActionAt,
  nextProspectStatus,
} from "@/lib/outreach-manual-call-rules";
export type { ManualOutreachCallOutcome } from "@/lib/outreach-manual-call-rules";

const CALL_INTERPRETATION_FORMAT = {
  type: "json_schema",
  name: "manual_outreach_call_interpretation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "summary",
      "intentSummary",
      "buyingSignals",
      "risks",
      "nextAction",
      "confidence",
    ],
    properties: {
      summary: { type: "string" },
      intentSummary: { type: "string" },
      buyingSignals: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
      },
      risks: {
        type: "array",
        maxItems: 3,
        items: { type: "string" },
      },
      nextAction: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  },
} as const;

const clean = (value: unknown, max: number) =>
  capitaliseSentenceStarts(
    String(value || "").replace(/\s+/g, " ").trim()
  ).slice(0, max);

function cleanInterpretation(value: any, fallbackNextAction: string) {
  return {
    summary: clean(value?.summary, 420),
    intentSummary: clean(value?.intentSummary, 600),
    buyingSignals: Array.isArray(value?.buyingSignals)
      ? value.buyingSignals.map((item: unknown) => clean(item, 220)).filter(Boolean).slice(0, 3)
      : [],
    risks: Array.isArray(value?.risks)
      ? value.risks.map((item: unknown) => clean(item, 220)).filter(Boolean).slice(0, 3)
      : [],
    nextAction: clean(value?.nextAction, 360) || fallbackNextAction,
    confidence: ["high", "medium", "low"].includes(value?.confidence)
      ? value.confidence
      : "low",
  };
}

export async function interpretManualOutreachCall(args: {
  workspaceId: string;
  userId: string;
  prospectId: string;
  campaignId: string | null;
  sourceEventId: string;
  requestId: string;
  outcome: ManualOutreachCallOutcome;
  note: string;
  humanNextAction: string;
}) {
  const { data: existing } = await supabaseAdmin
    .from("outreach_events")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("owner_id", args.userId)
    .eq("kind", "manual_call_interpreted")
    .contains("metadata", { requestId: args.requestId })
    .maybeSingle();
  if (existing) return;

  const { data: prospect, error: prospectError } = await supabaseAdmin
    .from("outreach_prospects")
    .select("id,first_name,last_name,job_title,company_name,source_metadata,assigned_to_user_id")
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.prospectId)
    .maybeSingle();
  if (prospectError || !prospect || prospect.assigned_to_user_id !== args.userId)
    return;

  let interpretation = cleanInterpretation({}, args.humanNextAction);
  let aiUsed = false;
  const needsInterpretation = !["no_answer", "voicemail", "do_not_contact"].includes(
    args.outcome
  );
  try {
    if (!needsInterpretation) {
      interpretation = cleanInterpretation(
        {
          summary:
            args.outcome === "no_answer"
              ? "No answer. No conversation or buying signal was recorded."
              : args.outcome === "voicemail"
                ? "Voicemail left. No conversation or buying signal was recorded."
                : "The prospect asked not to be contacted again.",
          intentSummary:
            args.outcome === "do_not_contact"
              ? "No further conversation should be started."
              : args.humanNextAction,
          buyingSignals: [],
          risks: [],
          nextAction: args.humanNextAction,
          confidence: "high",
        },
        args.humanNextAction
      );
    } else {
      const message = await openai.messages.create({
        model: OPENAI_MODEL_LIVE,
        max_tokens: 650,
        response_format: CALL_INTERPRETATION_FORMAT,
        system: `Turn one newly saved manual sales call note into concise CRM intelligence.
Return only the required JSON. Use British English and practical wording.

Rules
- The user's selected outcome and written next action are authoritative.
- Never invent budget, authority, urgency, value, commitments, objections or buying signals.
- A no answer or voicemail contains no buying signal.
- A booked meeting is not proof that a deal is qualified beyond the conversation itself.
- Intent summary means what the next conversation should achieve, based only on this note.
- If evidence is thin, keep signals and risks empty and set confidence low.
- Keep the result concise enough to reuse without reopening or reprocessing this call.`,
        messages: [{
          role: "user",
          content: JSON.stringify({
            prospect: {
              name: [prospect.first_name, prospect.last_name].filter(Boolean).join(" "),
              role: prospect.job_title,
              company: prospect.company_name,
            },
            call: {
              outcome: args.outcome,
              note: args.note,
              humanNextAction: args.humanNextAction,
            },
          }),
        }],
      }, { timeout: 18_000 });
      await logModelUsage(
        "manual_outreach_call",
        "live",
        (message as any).usage,
        { prospectId: args.prospectId, requestId: args.requestId },
        { userId: args.userId, workspaceId: args.workspaceId }
      );
      interpretation = cleanInterpretation(
        parseObject(modelText(message)),
        args.humanNextAction
      );
      // The human's explicit next action always wins over the compact model read.
      interpretation.nextAction = args.humanNextAction;
      aiUsed = true;
    }
  } catch {
    interpretation = cleanInterpretation({}, args.humanNextAction);
  }

  const metadata = {
    requestId: args.requestId,
    sourceEventId: args.sourceEventId,
    outcome: args.outcome,
    interpretation,
    aiUsed,
    actorUserId: args.userId,
  };
  const { error: eventError } = await supabaseAdmin.from("outreach_events").insert({
    workspace_id: args.workspaceId,
    owner_id: args.userId,
    visibility: "team",
    campaign_id: args.campaignId,
    prospect_id: args.prospectId,
    kind: "manual_call_interpreted",
    metadata,
  });
  if (eventError && eventError.code !== "23505") throw eventError;

  // Re-read after the model call. Another manual call or another CRM action
  // may have changed this prospect while the background interpretation ran.
  // Only enrich the same latest call and preserve every newer metadata field.
  const { data: currentProspect } = await supabaseAdmin
    .from("outreach_prospects")
    .select("source_metadata,assigned_to_user_id")
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.prospectId)
    .maybeSingle();
  if (!currentProspect || currentProspect.assigned_to_user_id !== args.userId)
    return;
  const sourceMetadata = currentProspect.source_metadata &&
    typeof currentProspect.source_metadata === "object"
    ? currentProspect.source_metadata
    : {};
  if (sourceMetadata?.latest_manual_call?.requestId !== args.requestId) return;
  await supabaseAdmin
    .from("outreach_prospects")
    .update({
      source_metadata: {
        ...sourceMetadata,
        latest_manual_call: {
          ...sourceMetadata.latest_manual_call,
          analysisStatus: "complete",
          interpretation,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.prospectId)
    .eq("assigned_to_user_id", args.userId);
}
