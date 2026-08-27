import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";

import {
  MANUAL_OUTREACH_CALL_OUTCOMES,
  defaultManualCallNextAction,
  interpretManualOutreachCall,
  manualCallNextActionAt,
  nextProspectStatus,
  type ManualOutreachCallOutcome,
} from "@/lib/outreach-manual-call";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { capitaliseSentenceStarts } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clean = (value: unknown, max: number) =>
  capitaliseSentenceStarts(
    String(value || "").replace(/\s+/g, " ").trim()
  ).slice(0, max);

const terminalOutcome = (outcome: ManualOutreachCallOutcome) =>
  outcome === "not_interested" || outcome === "do_not_contact";

const stopAutomatedSequence = (outcome: ManualOutreachCallOutcome) =>
  !["voicemail", "no_answer"].includes(outcome);

function enrolmentStatus(outcome: ManualOutreachCallOutcome) {
  if (outcome === "meeting_booked") return "booked";
  if (outcome === "do_not_contact") return "suppressed";
  if (outcome === "not_interested") return "completed";
  if (outcome === "voicemail" || outcome === "no_answer") return "contacted";
  return "paused";
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const requestId = String(body.requestId || "").trim();
    const outcome = String(body.outcome || "") as ManualOutreachCallOutcome;
    const note = clean(body.note, 4000);
    const durationMinutes = Math.max(
      0,
      Math.min(480, Math.round(Number(body.durationMinutes) || 0))
    );
    const requestedCampaignId = String(body.campaignId || "").trim();
    const followUpDate = String(body.followUpDate || "").trim();
    if (!UUID.test(requestId))
      return NextResponse.json({ error: "A valid call log request is required" }, { status: 400 });
    if (!MANUAL_OUTREACH_CALL_OUTCOMES.includes(outcome))
      return NextResponse.json({ error: "Choose what happened on the call" }, { status: 400 });
    if (note.length < 3)
      return NextResponse.json({ error: "Add a short factual note about the call" }, { status: 400 });
    if (followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate))
      return NextResponse.json({ error: "Choose a valid next action date" }, { status: 400 });

    const { data: prospect, error: prospectError } = await supabaseAdmin
      .from("outreach_prospects")
      .select("*")
      .eq("workspace_id", account.workspaceId)
      .eq("id", params.id)
      .maybeSingle();
    if (prospectError) throw prospectError;
    if (!prospect)
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    if (prospect.assigned_to_user_id !== account.userId)
      return NextResponse.json(
        { error: "Claim this prospect before logging a call" },
        { status: 403 }
      );

    let enrolmentQuery = supabaseAdmin
      .from("outreach_enrolments")
      .select("id,campaign_id,status")
      .eq("workspace_id", account.workspaceId)
      .eq("prospect_id", prospect.id)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (requestedCampaignId) {
      if (!UUID.test(requestedCampaignId))
        return NextResponse.json({ error: "The selected campaign is invalid" }, { status: 400 });
      enrolmentQuery = enrolmentQuery.eq("campaign_id", requestedCampaignId);
    }
    const { data: enrolments, error: enrolmentError } = await enrolmentQuery;
    if (enrolmentError) throw enrolmentError;
    const enrolment = enrolments?.[0] || null;
    if (requestedCampaignId && !enrolment)
      return NextResponse.json(
        { error: "This prospect does not belong to the selected campaign" },
        { status: 409 }
      );

    const now = new Date();
    const occurredAtRaw = String(body.occurredAt || "").trim();
    const requestedOccurredAt = occurredAtRaw ? new Date(occurredAtRaw) : now;
    const occurredAt = Number.isFinite(requestedOccurredAt.getTime()) &&
      requestedOccurredAt.getTime() <= now.getTime() + 5 * 60 * 1000
      ? requestedOccurredAt.toISOString()
      : now.toISOString();
    const occurredAtDate = new Date(occurredAt);
    const humanNextAction = terminalOutcome(outcome)
      ? defaultManualCallNextAction(outcome)
      : clean(body.nextAction, 360) || defaultManualCallNextAction(outcome);
    const nextActionAt = manualCallNextActionAt(
      outcome,
      followUpDate || null,
      occurredAtDate
    );

    const { data: existingEvent, error: existingError } = await supabaseAdmin
      .from("outreach_events")
      .select("id,metadata,created_at")
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("kind", "manual_call")
      .contains("metadata", { requestId })
      .maybeSingle();
    if (existingError) throw existingError;

    let callEvent = existingEvent;
    if (!callEvent) {
      const inserted = await supabaseAdmin
        .from("outreach_events")
        .insert({
          workspace_id: account.workspaceId,
          owner_id: account.userId,
          visibility: "team",
          campaign_id: enrolment?.campaign_id || null,
          prospect_id: prospect.id,
          kind: "manual_call",
          created_at: occurredAt,
          metadata: {
            requestId,
            outcome,
            note,
            durationMinutes: durationMinutes || null,
            humanNextAction,
            nextActionAt,
            actorUserId: account.userId,
            source: "salesperson_manual_call",
          },
        })
        .select("id,metadata,created_at")
        .single();
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
      if (inserted.data) callEvent = inserted.data;
      if (!callEvent) {
        const duplicate = await supabaseAdmin
          .from("outreach_events")
          .select("id,metadata,created_at")
          .eq("workspace_id", account.workspaceId)
          .eq("owner_id", account.userId)
          .eq("kind", "manual_call")
          .contains("metadata", { requestId })
          .single();
        if (duplicate.error) throw duplicate.error;
        callEvent = duplicate.data;
      }
    }

    const currentSource = prospect.source_metadata && typeof prospect.source_metadata === "object"
      ? prospect.source_metadata
      : {};
    const nextStatus = nextProspectStatus(prospect.status, outcome);
    const latestManualCall = {
      eventId: callEvent.id,
      requestId,
      outcome,
      notePreview: note.slice(0, 500),
      occurredAt,
      durationMinutes: durationMinutes || null,
      nextAction: humanNextAction,
      nextActionAt,
      campaignId: enrolment?.campaign_id || null,
      actorUserId: account.userId,
      analysisStatus: "pending",
    };
    const { data: updatedProspect, error: updateError } = await supabaseAdmin
      .from("outreach_prospects")
      .update({
        status: nextStatus,
        last_contacted_at: occurredAt,
        next_action_at: nextActionAt,
        suppression_reason: outcome === "do_not_contact"
          ? "Asked not to be contacted during a manual call"
          : prospect.suppression_reason,
        source_metadata: {
          ...currentSource,
          latest_manual_call: latestManualCall,
        },
        updated_at: now.toISOString(),
      })
      .eq("workspace_id", account.workspaceId)
      .eq("id", prospect.id)
      .eq("assigned_to_user_id", account.userId)
      .select("id,status,last_contacted_at,next_action_at,source_metadata")
      .single();
    if (updateError) throw updateError;

    const writes: PromiseLike<any>[] = [];
    if (enrolment) {
      writes.push(
        supabaseAdmin
          .from("outreach_enrolments")
          .update({
            status: enrolmentStatus(outcome),
            next_action_at: nextActionAt,
            updated_at: now.toISOString(),
          })
          .eq("workspace_id", account.workspaceId)
          .eq("id", enrolment.id)
      );
    }
    if (stopAutomatedSequence(outcome)) {
      writes.push(
        supabaseAdmin
          .from("outreach_messages")
          .update({
            status: "cancelled",
            scheduled_at: null,
            error: "Stopped after a manually logged sales call",
            updated_at: now.toISOString(),
          })
          .eq("workspace_id", account.workspaceId)
          .eq("prospect_id", prospect.id)
          .eq("sender_user_id", account.userId)
          .in("status", ["draft", "approved"])
      );
    }
    if (outcome === "do_not_contact") {
      writes.push(
        supabaseAdmin.from("outreach_suppressions").upsert({
          target: String(prospect.email || "").trim().toLowerCase(),
          kind: "email",
          reason: "Asked not to be contacted during a manual call",
          source: "manual_call",
          workspace_id: account.workspaceId,
          owner_id: account.userId,
          visibility: "team",
        })
      );
    }
    const writeResults = await Promise.all(writes);
    const writeFailure = writeResults.find((result) => result?.error);
    if (writeFailure?.error) throw writeFailure.error;

    waitUntil(
      interpretManualOutreachCall({
        workspaceId: account.workspaceId,
        userId: account.userId,
        prospectId: prospect.id,
        campaignId: enrolment?.campaign_id || null,
        sourceEventId: callEvent.id,
        requestId,
        outcome,
        note,
        humanNextAction,
      }).catch(async () => {
        const sourceMetadata = updatedProspect.source_metadata &&
          typeof updatedProspect.source_metadata === "object"
          ? updatedProspect.source_metadata
          : {};
        if (sourceMetadata?.latest_manual_call?.requestId !== requestId) return;
        await supabaseAdmin
          .from("outreach_prospects")
          .update({
            source_metadata: {
              ...sourceMetadata,
              latest_manual_call: {
                ...sourceMetadata.latest_manual_call,
                analysisStatus: "failed",
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("workspace_id", account.workspaceId)
          .eq("id", prospect.id)
          .eq("assigned_to_user_id", account.userId);
      })
    );

    return NextResponse.json({
      saved: true,
      duplicate: Boolean(existingEvent),
      eventId: callEvent.id,
      prospect: updatedProspect,
      nextAction: humanNextAction,
      nextActionAt,
      analysisPending: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The manual call could not be saved" },
      { status: 500 }
    );
  }
}
