import { NextRequest, NextResponse } from "next/server";

import { getCommercialMemory } from "@/lib/commercial-memory";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { loadVisibleOpportunityById } from "@/lib/opportunity-access";
import { modelText, parseObject } from "@/lib/outreach";
import {
  QUICK_CALL_OUTCOMES,
  QUICK_CALL_STAGES,
  cleanQuickCallSuggestion,
  dueDateFromDays,
  fallbackQuickCallSuggestion,
  type QuickCallOutcome,
} from "@/lib/quick-call";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { capitaliseSentenceStarts } from "@/lib/text";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CALL_NOTE_FORMAT = {
  type: "json_schema",
  name: "quick_sales_call_update",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "pipelineStage",
      "nextAction",
      "nextActionOwner",
      "dueInDays",
      "rationale",
    ],
    properties: {
      pipelineStage: { type: "string", enum: QUICK_CALL_STAGES },
      nextAction: { type: "string" },
      nextActionOwner: { type: "string", enum: ["us", "buyer", "joint"] },
      dueInDays: { type: "integer", minimum: 0, maximum: 90 },
      rationale: { type: "string" },
    },
  },
} as const;

const cleanNote = (value: unknown) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, 1600);

async function existingInterpretation(
  workspaceId: string,
  opportunityId: string,
  requestId: string
) {
  const { data, error } = await supabaseAdmin
    .from("opportunity_events")
    .select("evidence,rationale,created_at")
    .eq("workspace_id", workspaceId)
    .eq("opportunity_id", opportunityId)
    .eq("event_type", "call_interpreted")
    .contains("evidence", { requestId })
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const requestId = String(body.requestId || "").trim();
    const note = cleanNote(body.note);
    const outcome = String(body.outcome || "") as QuickCallOutcome;
    if (!UUID.test(requestId)) {
      return NextResponse.json({ error: "A valid call log request is required" }, { status: 400 });
    }
    if (note.length < 3) {
      return NextResponse.json({ error: "Add a short note about the call" }, { status: 400 });
    }
    if (!QUICK_CALL_OUTCOMES.includes(outcome)) {
      return NextResponse.json({ error: "Choose the call outcome" }, { status: 400 });
    }

    const opportunity = await loadVisibleOpportunityById<any>(
      account,
      params.id
    );
    if (!opportunity) {
      return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
    }
    if (
      account.role === "sales" &&
      opportunity.owner_id !== account.userId &&
      opportunity.assigned_to_user_id !== account.userId
    ) {
      return NextResponse.json(
        { error: "This deal is assigned to another salesperson" },
        { status: 403 }
      );
    }
    if (opportunity.status !== "open" || opportunity.opportunity_type !== "revenue") {
      return NextResponse.json(
        { error: "Quick call logging is available for open sales opportunities" },
        { status: 409 }
      );
    }

    const previous = await existingInterpretation(
      account.workspaceId,
      opportunity.id,
      requestId
    );
    if (previous) {
      return NextResponse.json({
        noteSaved: true,
        duplicate: true,
        suggestion: previous.evidence?.suggestion || null,
        applied: previous.evidence?.applied || [],
        protected: previous.evidence?.protected || [],
        opportunity,
      });
    }

    const now = new Date().toISOString();
    // The canonical deal can be shared, but the salesperson's raw call note is
    // private source material. Owner and assignee access it only through this
    // verified opportunity route, never through broad team-row visibility.
    const eventVisibility = "private";
    const { error: callEventError } = await supabaseAdmin
      .from("opportunity_events")
      .insert({
        opportunity_id: opportunity.id,
        company_id: opportunity.company_id,
        event_type: "call_logged",
        source_type: "human",
        source_channel: "phone",
        rationale: `Call note logged by the assigned salesperson`,
        changes: {},
        evidence: {
          requestId,
          outcome,
          note,
          actorUserId: account.userId,
        },
        workspace_id: account.workspaceId,
        owner_id: account.userId,
        visibility: eventVisibility,
        created_at: now,
      });
    if (callEventError && callEventError.code !== "23505") throw callEventError;

    const fallback = fallbackQuickCallSuggestion({
      outcome,
      currentStage: opportunity.pipeline_stage,
      currentNextAction: opportunity.next_action,
    });
    let suggestion = fallback;
    let aiUsed = false;
    if (
      outcome === "connected" &&
      !(
        opportunity.pipeline_stage_override === true &&
        opportunity.next_action_override === true
      )
    ) {
      try {
        const message = await openai.messages.create({
          model: OPENAI_MODEL_LIVE,
          max_tokens: 450,
          response_format: CALL_NOTE_FORMAT,
          system: `Turn one newly saved sales call note into a conservative CRM update.
Return only the required JSON. Use British English and short, practical wording.

Rules
- The lifecycle stage is separate from win outlook. Never infer won or lost.
- Keep the current lifecycle stage unless the note explicitly proves a later stage.
- Discovery means a real conversation but need or fit is still being established.
- Qualified requires an explicit need plus a plausible buyer or decision path.
- Proposal requires a proposal, pilot or commercial offer being actively considered.
- Negotiation requires active commercial or contract discussion.
- Verbal requires a clear verbal commitment that still needs completion.
- Produce one concrete next action, its owner and a sensible number of days.
- Do not invent budget, authority, urgency, value or commitments.
- The note is the only new evidence.`,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                current: {
                  title: String(opportunity.title || "").slice(0, 180),
                  pipelineStage: opportunity.pipeline_stage,
                  nextAction: String(opportunity.next_action || "").slice(0, 500),
                  nextActionOwner: opportunity.next_action_owner || "us",
                },
                newCall: { outcome, note },
              }),
            },
          ],
        });
        await logModelUsage(
          "quick-call-update",
          "live",
          (message as any).usage,
          { opportunityId: opportunity.id },
          { userId: account.userId, workspaceId: account.workspaceId }
        );
        suggestion = cleanQuickCallSuggestion(
          parseObject(modelText(message)),
          fallback
        );
        aiUsed = true;
      } catch {
        suggestion = fallback;
      }
    }

    const protectedFields: string[] = [];
    const appliedFields: string[] = [];
    const patch: Record<string, any> = {
      active_contact_method: "phone",
      last_meaningful_activity_at: now,
      updated_at: now,
    };
    if (opportunity.pipeline_stage_override === true) {
      protectedFields.push("stage");
    } else {
      patch.pipeline_stage = suggestion.pipelineStage;
      if (suggestion.pipelineStage !== opportunity.pipeline_stage) {
        appliedFields.push("stage");
      }
    }
    if (opportunity.next_action_override === true) {
      protectedFields.push("next action");
    } else {
      patch.next_action = capitaliseSentenceStarts(suggestion.nextAction);
      patch.next_action_owner = suggestion.nextActionOwner;
      patch.next_action_due_at = `${dueDateFromDays(suggestion.dueInDays)}T12:00:00Z`;
      appliedFields.push("next action");
    }
    patch.last_change_context = {
      nonce: crypto.randomUUID(),
      sourceType: "system",
      sourceChannel: "quick_call_log",
      rationale: suggestion.rationale,
      evidence: {
        requestId,
        callLog: true,
        protectedFields,
      },
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("opportunities")
      .update(patch)
      .eq("id", opportunity.id)
      .eq("workspace_id", account.workspaceId)
      .eq("status", "open")
      .select()
      .single();
    if (updateError) throw updateError;

    const interpretationEvidence = {
      requestId,
      outcome,
      suggestion,
      applied: appliedFields,
      protected: protectedFields,
      aiUsed,
      actorUserId: account.userId,
    };
    const { error: interpretationError } = await supabaseAdmin
      .from("opportunity_events")
      .insert({
        opportunity_id: opportunity.id,
        company_id: opportunity.company_id,
        event_type: "call_interpreted",
        source_type: "system",
        source_channel: "quick_call_log",
        rationale: suggestion.rationale,
        changes: {},
        evidence: interpretationEvidence,
        workspace_id: account.workspaceId,
        owner_id: account.userId,
        visibility: eventVisibility,
        created_at: new Date().toISOString(),
      });
    const interpretationSaved =
      !interpretationError || interpretationError.code === "23505";

    if (updated.owner_id === account.userId && updated.company_id) {
      try {
        await getCommercialMemory(
          updated.company_id,
          updated.workstream_id || null
        );
      } catch {
        // The source note and canonical deal update are already committed.
        // Compact memory can repair on its normal next read without making the
        // salesperson repeat or pay for this call log.
      }
    }

    return NextResponse.json({
      noteSaved: true,
      suggestion,
      applied: appliedFields,
      protected: protectedFields,
      interpretationSaved,
      opportunity: updated,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The call note could not be saved" },
      { status: 500 }
    );
  }
}
