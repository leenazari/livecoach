import { NextRequest, NextResponse } from "next/server";
import { createCanonicalOpenRevenueOpportunity } from "@/lib/canonical-opportunity";
import { loadVisibleOpportunityById } from "@/lib/opportunity-access";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set([
  "same_deal",
  "separate_workstream",
  "not_an_opportunity",
]);

const cleanName = (value: unknown, fallback: string) => {
  const name = typeof value === "string" ? value.trim() : "";
  return (name || fallback).slice(0, 180);
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "";
    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { error: "Choose whether this is the same deal, a separate workstream or not an opportunity" },
        { status: 400 }
      );
    }

    const { data: task, error: taskError } = await supabaseAdmin
      .from("tasks")
      .select("id,company_id,kind,status,payload,workspace_id,owner_id")
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!task || task.kind !== "opportunity_clarification") {
      return NextResponse.json({ error: "That confirmation item was not found" }, { status: 404 });
    }
    if (task.status !== "open") {
      return NextResponse.json(
        { error: "That opportunity question has already been answered" },
        { status: 409 }
      );
    }

    const payload =
      task.payload && typeof task.payload === "object" ? task.payload : {};
    if (payload.clarificationType !== "opportunity_scope") {
      return NextResponse.json({ error: "That confirmation item is invalid" }, { status: 409 });
    }
    const existingOpportunityId = String(payload.existingOpportunityId || "");
    const existing = await loadVisibleOpportunityById<any>(
      account,
      existingOpportunityId,
      "id,company_id,title,workspace_id,owner_id,visibility,assigned_to_user_id,status,opportunity_type"
    );
    if (
      !existing ||
      existing.company_id !== task.company_id ||
      existing.status !== "open" ||
      (existing.opportunity_type || "revenue") !== "revenue"
    ) {
      return NextResponse.json(
        { error: "The original active deal changed. Refresh the pipeline before answering." },
        { status: 409 }
      );
    }

    const proposedTitle = cleanName(payload.proposedTitle, "Separate opportunity");
    let separateOpportunity: Record<string, any> | null = null;
    let workstream: Record<string, any> | null = null;
    let createdWorkstream = false;

    if (action === "separate_workstream") {
      const workstreamName = cleanName(body.workstreamName, proposedTitle);
      const { data: currentWorkstreams, error: currentError } = await supabaseAdmin
        .from("workstreams")
        .select("id,name,status,owner_id,visibility")
        .eq("workspace_id", account.workspaceId)
        .eq("company_id", task.company_id)
        .eq("status", "active")
        .limit(100);
      if (currentError) throw currentError;
      const duplicateName = (currentWorkstreams || []).find(
        (row: any) =>
          String(row.name || "").trim().toLowerCase() ===
          workstreamName.toLowerCase()
      );
      if (duplicateName) {
        if (
          duplicateName.visibility !== "team" &&
          duplicateName.owner_id !== account.userId
        ) {
          return NextResponse.json(
            {
              error:
                "That workstream name is already reserved by another private record. Choose a more specific name.",
            },
            { status: 409 }
          );
        }
        workstream = duplicateName;
      } else {
        const { data: insertedWorkstream, error: workstreamError } =
          await supabaseAdmin
            .from("workstreams")
            .insert({
              company_id: task.company_id,
              name: workstreamName,
              kind: "opportunity",
              status: "active",
              purpose:
                typeof payload.proposedDetail === "string"
                  ? payload.proposedDetail.slice(0, 1000)
                  : null,
              workspace_id: account.workspaceId,
              owner_id: account.userId,
              visibility: existing.visibility === "team" ? "team" : "private",
            })
            .select()
            .single();
        if (workstreamError) throw workstreamError;
        if (!insertedWorkstream)
          throw new Error("The database did not confirm the new workstream");
        workstream = insertedWorkstream;
        createdWorkstream = true;
      }
      if (!workstream)
        throw new Error("The database did not confirm the workstream choice");
      const workstreamId = String(workstream.id);

      try {
        const created = await createCanonicalOpenRevenueOpportunity(
          {
            id: String(task.company_id),
            workspace_id: account.workspaceId,
            owner_id: account.userId,
            visibility: existing.visibility === "team" ? "team" : "private",
          },
          {
            title: proposedTitle,
            detail:
              typeof payload.proposedDetail === "string"
                ? payload.proposedDetail
                : null,
            value:
              typeof payload.proposedValue === "number"
                ? payload.proposedValue
                : null,
            sessionId:
              typeof payload.proposedSessionId === "string"
                ? payload.proposedSessionId
                : null,
            workstreamId,
            clarificationTaskId: task.id,
            source: "opportunity_scope_confirmation",
            surfacedByAi: false,
            assignedToUserId: account.userId,
          }
        );
        if (!created.created) {
          const createdForThisQuestion =
            created.opportunity?.source === "opportunity_scope_confirmation" &&
            created.opportunity?.last_change_context?.evidence
              ?.clarificationTaskId === task.id;
          if (!createdForThisQuestion && createdWorkstream)
            await supabaseAdmin
              .from("workstreams")
              .delete()
              .eq("workspace_id", account.workspaceId)
              .eq("owner_id", account.userId)
              .eq("id", workstreamId);
          if (createdForThisQuestion) {
            separateOpportunity = created.opportunity;
          } else {
            return NextResponse.json(
              { error: "A deal already exists in that workstream. Nothing was duplicated." },
              { status: 409 }
            );
          }
        } else {
          separateOpportunity = created.opportunity;
        }
      } catch (error) {
        if (createdWorkstream)
          await supabaseAdmin
            .from("workstreams")
            .delete()
            .eq("workspace_id", account.workspaceId)
            .eq("owner_id", account.userId)
            .eq("id", workstreamId);
        throw error;
      }
    }

    const resolution =
      action === "same_deal"
        ? "same deal"
        : action === "not_an_opportunity"
          ? "not an opportunity"
          : "separate workstream";
    const now = new Date().toISOString();
    const { data: existingHistory, error: historyLookupError } =
      await supabaseAdmin
        .from("opportunity_events")
        .select("id")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .eq("opportunity_id", existing.id)
        .eq("source_channel", "opportunity_scope_confirmation")
        .contains("evidence", { clarificationTaskId: task.id })
        .limit(1)
        .maybeSingle();
    if (historyLookupError) throw historyLookupError;

    if (!existingHistory) {
      const { error: historyError } = await supabaseAdmin
        .from("opportunity_events")
        .insert({
          opportunity_id: existing.id,
          company_id: existing.company_id,
          event_type: "updated",
          source_type: "human",
          source_channel: "opportunity_scope_confirmation",
          rationale: `Confirmed as ${resolution}`,
          changes: {
            opportunity_scope: {
              old: "unconfirmed",
              new: action,
            },
          },
          evidence: {
            clarificationTaskId: task.id,
            proposedTitle,
            proposedDetail: payload.proposedDetail || null,
            proposedSource: payload.proposedSource || null,
            proposedSessionId: payload.proposedSessionId || null,
            separateWorkstreamId: workstream?.id || null,
            separateOpportunityId: separateOpportunity?.id || null,
          },
          workspace_id: account.workspaceId,
          owner_id: account.userId,
          visibility: "private",
        });
      if (historyError) throw historyError;
    }

    const { data: savedTask, error: saveError } = await supabaseAdmin
      .from("tasks")
      .update({
        status: "done",
        done_at: now,
        payload: {
          ...payload,
          resolution: action,
          resolvedAt: now,
          resolvedByUserId: account.userId,
          separateWorkstreamId: workstream?.id || null,
          separateOpportunityId: separateOpportunity?.id || null,
        },
      })
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("id", task.id)
      .eq("status", "open")
      .select("id,status")
      .maybeSingle();
    if (saveError) throw saveError;
    if (savedTask?.status !== "done") {
      throw new Error("The database did not confirm the opportunity decision");
    }

    return NextResponse.json({
      ok: true,
      resolution: action,
      existingOpportunityId: existing.id,
      separateOpportunityId: separateOpportunity?.id || null,
      workstreamId: workstream?.id || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The opportunity decision could not be saved" },
      { status: 500 }
    );
  }
}
