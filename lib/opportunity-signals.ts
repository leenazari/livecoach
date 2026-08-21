import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { getCommercialMemory } from "@/lib/commercial-memory";
import { modelText, parseObject } from "@/lib/outreach";
import {
  CONTACT_METHODS,
  WIN_OUTLOOKS,
  cleanStringList,
  defaultOutlookQuestions,
} from "@/lib/opportunity-fields";
import { getRequestScope } from "@/lib/request-scope";

export type OpportunitySignalSource =
  | "call_summary"
  | "important_email"
  | "manual_activity"
  | "outreach_reply";

export type OpportunitySignalChannel = (typeof CONTACT_METHODS)[number];

type EnqueueSignal = {
  companyId: string;
  workstreamId?: string | null;
  opportunityId?: string | null;
  sourceRecordType: OpportunitySignalSource;
  sourceRecordId: string;
  sourceChannel: OpportunitySignalChannel;
  occurredAt?: string | null;
  evidence: Record<string, unknown>;
};

const ASSESSMENT_FORMAT = {
  type: "json_schema",
  name: "opportunity_outlook_assessment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["material", "outlook", "confidence", "reasons", "questions", "rationale"],
    properties: {
      material: { type: "boolean" },
      outlook: {
        type: "string",
        enum: ["not_assessed", "at_risk", "possible", "likely", "highly_likely"],
      },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      reasons: { type: "array", maxItems: 4, items: { type: "string" } },
      questions: { type: "array", maxItems: 4, items: { type: "string" } },
      rationale: { type: "string" },
    },
  },
} as const;

const text = (value: unknown, max = 500) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

const compactEvidence = (value: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value || {}).slice(0, 14)) {
    if (typeof raw === "string") {
      const clean = text(raw, key === "summary" || key === "overview" ? 1200 : 320);
      if (clean) out[key] = clean;
    } else if (Array.isArray(raw)) {
      const clean = raw
        .filter((item): item is string => typeof item === "string")
        .map((item) => text(item, 260))
        .filter(Boolean)
        .slice(0, 5);
      if (clean.length) out[key] = clean;
    } else if (typeof raw === "boolean" || typeof raw === "number") {
      out[key] = raw;
    }
  }
  return out;
};

const validDate = (value: string | null | undefined) => {
  const parsed = value ? new Date(value) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
};

async function resolveOpportunity(input: EnqueueSignal) {
  const requestScope = getRequestScope();
  let query = supabaseAdmin
    .from("opportunities")
    .select("id, workstream_id, owner_id, workspace_id, visibility")
    .eq("company_id", input.companyId)
    .eq("opportunity_type", "revenue")
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(20);
  if (input.opportunityId) query = query.eq("id", input.opportunityId);
  else if (input.workstreamId) query = query.eq("workstream_id", input.workstreamId);
  const { data, error } = await query;
  if (error) throw error;
  if ((data || []).length !== 1) return null;
  const opportunity = data![0];
  // A person's private call or email may not silently change a shared deal
  // owned by somebody else. They can still make an explicit pipeline edit.
  if (requestScope && opportunity.owner_id !== requestScope.userId) return null;
  return opportunity;
}

// Called at the same boundary that saves the authoritative call/email/activity.
// It stores only a bounded digest and is idempotent for that source record.
export async function enqueueOpportunitySignal(input: EnqueueSignal) {
  if (!input.companyId || !input.sourceRecordId) return { queued: false, reason: "missing_identity" };
  if (!CONTACT_METHODS.includes(input.sourceChannel)) return { queued: false, reason: "invalid_channel" };
  const requestScope = getRequestScope();
  const opportunity = await resolveOpportunity(input);
  let recordOwnerId = opportunity?.owner_id || requestScope?.userId || "";
  let recordWorkspaceId = opportunity?.workspace_id || requestScope?.workspaceId || "";
  if (!recordOwnerId || !recordWorkspaceId) {
    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("owner_id,workspace_id")
      .eq("id", input.companyId)
      .maybeSingle();
    if (companyError) throw companyError;
    recordOwnerId = company?.owner_id || "";
    recordWorkspaceId = company?.workspace_id || "";
  }
  if (!recordOwnerId || !recordWorkspaceId) {
    return { queued: false, reason: "missing_record_scope" };
  }
  const status = opportunity ? "queued" : "ignored";
  const result = opportunity
    ? {}
    : { reason: input.opportunityId ? "opportunity_not_open" : "no_single_open_revenue_opportunity" };
  const { data, error } = await supabaseAdmin
    .from("opportunity_signal_receipts")
    .upsert(
      {
        company_id: input.companyId,
        workstream_id: input.workstreamId || null,
        opportunity_id: opportunity?.id || null,
        source_record_type: input.sourceRecordType,
        source_record_id: text(input.sourceRecordId, 220),
        source_channel: input.sourceChannel,
        occurred_at: validDate(input.occurredAt),
        evidence: compactEvidence(input.evidence),
        status,
        result,
        owner_id: recordOwnerId,
        workspace_id: recordWorkspaceId,
        visibility: "private",
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "owner_id,company_id,source_record_type,source_record_id",
        ignoreDuplicates: true,
      }
    )
    .select("id,status,opportunity_id")
    .maybeSingle();
  if (error) throw error;
  return data
    ? { queued: data.status === "queued", receiptId: data.id, opportunityId: data.opportunity_id }
    : { queued: false, reason: "already_recorded" };
}

const newerIso = (current: unknown, candidate: string) => {
  const currentMs = current ? new Date(String(current)).getTime() : 0;
  const candidateMs = new Date(candidate).getTime();
  return Number.isFinite(candidateMs) && candidateMs > currentMs
    ? candidate
    : current || null;
};

async function assessReceipt(receipt: any) {
  const now = new Date().toISOString();
  const nextAttempt = Math.min(3, Number(receipt.attempts || 0) + 1);
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("opportunity_signal_receipts")
    .update({ status: "processing", attempts: nextAttempt, error: null, updated_at: now })
    .eq("id", receipt.id)
    .eq("status", receipt.status)
    .eq("attempts", Number(receipt.attempts || 0))
    .select("*")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { status: "skipped" };

  try {
    const { data: opportunity, error } = await supabaseAdmin
      .from("opportunities")
      .select("*")
      .eq("id", claimed.opportunity_id)
      .eq("company_id", claimed.company_id)
      .eq("owner_id", claimed.owner_id)
      .eq("workspace_id", claimed.workspace_id)
      .maybeSingle();
    if (error) throw error;
    if (!opportunity || opportunity.status !== "open") {
      await supabaseAdmin.from("opportunity_signal_receipts").update({
        status: "ignored",
        result: { reason: "opportunity_is_not_open" },
        updated_at: new Date().toISOString(),
      }).eq("id", claimed.id);
      return { status: "ignored" };
    }

    // If the outlook write committed but the receipt confirmation was
    // interrupted, recover from the immutable history instead of paying to
    // assess the same evidence again.
    const { data: appliedEvents } = await supabaseAdmin
      .from("opportunity_events")
      .select("id")
      .eq("opportunity_id", opportunity.id)
      .contains("evidence", { receiptId: claimed.id })
      .limit(1);
    if (appliedEvents?.length) {
      await supabaseAdmin.from("opportunity_signal_receipts").update({
        status: "complete",
        result: { recoveredFromHistory: true },
        error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", claimed.id);
      return { status: "complete" };
    }

    if (opportunity.win_outlook_override === true) {
      await Promise.all([
        supabaseAdmin.from("opportunities").update({
          last_meaningful_activity_at: newerIso(
            opportunity.last_meaningful_activity_at,
            claimed.occurred_at
          ),
          active_contact_method: claimed.source_channel,
          updated_at: new Date().toISOString(),
        }).eq("id", opportunity.id),
        supabaseAdmin.from("opportunity_signal_receipts").update({
          status: "protected",
          result: { reason: "human_outlook_override_preserved" },
          updated_at: new Date().toISOString(),
        }).eq("id", claimed.id),
      ]);
      await getCommercialMemory(opportunity.company_id, opportunity.workstream_id || null);
      return { status: "protected" };
    }

    const system = `You assess one NEW piece of stored commercial evidence against one existing revenue opportunity.
Return only the required JSON. Do not change lifecycle stage, manual probability, value or forecast category.

OUTLOOK MEANINGS:
- not_assessed: the evidence is not enough to judge commercial momentum.
- at_risk: explicit objection, delay, loss of momentum, missing commitment after a promised step, or credible threat to progress.
- possible: a real need or interest exists, but authority, urgency, commitment or a mutual next step is still missing.
- likely: explicit need plus credible stakeholder engagement and a dated mutual next step or decision path.
- highly_likely: explicit commercial commitment with authority and a clear remaining route to signature or rollout.

Rules:
- Evidence means explicit facts in the saved signal. Warm language, a meeting booking, a job title or lifecycle stage alone do not prove a likely win.
- Confidence is confidence in your classification, never a hidden win probability.
- A human override is handled before this request and must never be inferred or cleared here.
- Keep only up to four short evidence reasons. Preserve earlier reasons only when the current record still supports them.
- If evidence is missing, ask precise questions for the next conversation. Do not invent a stronger score.
- Mark material false when the new signal does not affect commercial momentum. Use British English and plain sentences.`;
    const current = {
      title: opportunity.title,
      lifecycleStage: opportunity.pipeline_stage,
      dealIntent: opportunity.deal_intent,
      currentOutlook: opportunity.win_outlook,
      currentConfidence: opportunity.win_outlook_confidence,
      existingReasons: opportunity.win_outlook_reasons,
      existingQuestions:
        Array.isArray(opportunity.win_outlook_questions) && opportunity.win_outlook_questions.length
          ? opportunity.win_outlook_questions
          : defaultOutlookQuestions(opportunity),
      nextAction: opportunity.next_action,
      nextActionDueAt: opportunity.next_action_due_at,
      expectedCloseAt: opportunity.expected_close_at,
    };
    const message = await openai.messages.create({
      model: OPENAI_MODEL_LIVE,
      max_tokens: 650,
      response_format: ASSESSMENT_FORMAT,
      system,
      messages: [{
        role: "user",
        content: `CURRENT OPPORTUNITY:\n${JSON.stringify(current)}\n\nNEW STORED EVIDENCE (${claimed.source_record_type}, ${claimed.occurred_at}):\n${JSON.stringify(claimed.evidence)}`,
      }],
    });
    await logModelUsage(
      "opportunity_outlook_assessment",
      "live",
      (message as any).usage,
      {
        sourceRecordType: claimed.source_record_type,
        opportunityId: opportunity.id,
      },
      { userId: claimed.owner_id, workspaceId: claimed.workspace_id }
    );
    const assessment = parseObject(modelText(message));
    if (!assessment || !WIN_OUTLOOKS.includes(assessment.outlook))
      throw new Error("outlook assessment was incomplete");

    const reasons = cleanStringList(assessment.reasons, 4, 240);
    const questions = cleanStringList(assessment.questions, 4, 300);
    const material = assessment.material === true;
    const confidence = Math.min(100, Math.max(0, Math.round(Number(assessment.confidence) || 0)));
    const rationale = text(assessment.rationale, 500) || "Assessed from one new stored CRM signal";
    const result = {
      material,
      outlook: assessment.outlook,
      confidence,
      reasons,
      questions,
      rationale,
    };
    if (!material) {
      await supabaseAdmin.from("opportunity_signal_receipts").update({
        status: "ignored",
        result,
        updated_at: new Date().toISOString(),
      }).eq("id", claimed.id);
      return { status: "ignored" };
    }

    const assessedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("opportunities")
      .update({
        win_outlook: assessment.outlook,
        win_outlook_confidence: confidence,
        win_outlook_reasons: reasons,
        win_outlook_questions: questions,
        win_outlook_as_of: assessedAt,
        win_outlook_source: "system",
        active_contact_method: claimed.source_channel,
        last_meaningful_activity_at: newerIso(
          opportunity.last_meaningful_activity_at,
          claimed.occurred_at
        ),
        last_change_context: {
          nonce: crypto.randomUUID(),
          sourceType: "system",
          sourceChannel: claimed.source_channel,
          rationale,
          evidence: {
            receiptId: claimed.id,
            sourceRecordType: claimed.source_record_type,
            sourceRecordId: claimed.source_record_id,
            occurredAt: claimed.occurred_at,
            digest: claimed.evidence,
          },
        },
        updated_at: assessedAt,
      })
      .eq("id", opportunity.id)
      .eq("owner_id", claimed.owner_id)
      .eq("workspace_id", claimed.workspace_id)
      .eq("status", "open")
      .eq("win_outlook_override", false)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      await supabaseAdmin.from("opportunity_signal_receipts").update({
        status: "protected",
        result: { ...result, reason: "human_override_or_closed_during_assessment" },
        updated_at: new Date().toISOString(),
      }).eq("id", claimed.id);
      return { status: "protected" };
    }
    await supabaseAdmin.from("opportunity_signal_receipts").update({
      status: "complete",
      result,
      updated_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    await getCommercialMemory(opportunity.company_id, opportunity.workstream_id || null);
    return { status: "complete" };
  } catch (error: any) {
    await supabaseAdmin.from("opportunity_signal_receipts").update({
      status: "failed",
      error: text(error?.message || "assessment failed", 600),
      updated_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    return { status: "failed" };
  }
}

export async function processQueuedOpportunitySignals(limit = 6) {
  const retryBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const [{ data: queued }, { data: failed }] = await Promise.all([
    supabaseAdmin
      .from("opportunity_signal_receipts")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit),
    supabaseAdmin
      .from("opportunity_signal_receipts")
      .select("*")
      .eq("status", "failed")
      .lt("attempts", 3)
      .lt("updated_at", retryBefore)
      .order("updated_at", { ascending: true })
      .limit(limit),
  ]);
  const rows = [...(queued || []), ...(failed || [])]
    .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
    .slice(0, limit);
  const outcomes = await Promise.all(rows.map(assessReceipt));
  return outcomes.reduce(
    (summary, outcome) => {
      summary.processed += 1;
      summary[outcome.status as keyof typeof summary] =
        Number(summary[outcome.status as keyof typeof summary] || 0) + 1;
      return summary;
    },
    { processed: 0, complete: 0, ignored: 0, protected: 0, failed: 0, skipped: 0 }
  );
}
