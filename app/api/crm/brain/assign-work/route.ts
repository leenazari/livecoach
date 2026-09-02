import { NextRequest, NextResponse } from "next/server";

import { crmBlockerPayload } from "@/lib/crm-blocker";
import { requireWorkspaceOwner } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(["task", "call"]);

// Owner-only delegation keeps the source record private. Tasks are transferred
// into the assignee's own task list. Calendar calls stay bound to the owner's
// provider account and create an assignee-owned call task instead. A linked
// client must already be explicitly shared with that exact assignee.
export async function POST(request: NextRequest) {
  try {
    const scope = requireWorkspaceOwner();
    const body = await request.json().catch(() => ({}));
    const kind = String(body?.kind || "").trim().toLowerCase();
    const recordId = String(body?.recordId || "").trim();
    const assignedToUserId = String(body?.assignedToUserId || "").trim();
    if (!KINDS.has(kind) || !UUID.test(recordId)) {
      return NextResponse.json(
        { error: "Choose one exact task or call to delegate" },
        { status: 400 }
      );
    }
    if (!UUID.test(assignedToUserId) || assignedToUserId === scope.userId) {
      return NextResponse.json(
        { error: "Choose another active workspace member" },
        { status: 400 }
      );
    }

    const { data: assignee, error: assigneeError } = await supabaseService
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", assignedToUserId)
      .eq("status", "active")
      .maybeSingle();
    if (assigneeError) throw assigneeError;
    if (!assignee) {
      return NextResponse.json(
        { error: "Choose an active member of this workspace" },
        { status: 400 }
      );
    }

    const table = kind === "task" ? "tasks" : "upcoming_calls";
    const { data: sourceData, error: sourceError } = await supabaseService
      .from(table)
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("id", recordId)
      .maybeSingle();
    const source = sourceData as any;
    if (sourceError) throw sourceError;
    if (!source) {
      return NextResponse.json(
        { error: `That ${kind} is not in your private account` },
        { status: 404 }
      );
    }
    if (
      (kind === "task" && source.status === "done") ||
      (kind === "call" && source.completed_at)
    ) {
      return NextResponse.json(
        { error: `That ${kind} is already complete` },
        { status: 409 }
      );
    }

    if (source.company_id) {
      const { data: grant, error: grantError } = await supabaseService
        .from("team_client_shares")
        .select("company_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("company_id", source.company_id)
        .eq("assigned_to_user_id", assignedToUserId)
        .eq("status", "active")
        .maybeSingle();
      if (grantError) throw grantError;
      if (!grant) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "delegation_client_not_assigned",
            title: `${kind === "task" ? "Task" : "Call"} not delegated`,
            reason:
              "The linked client has not been safely assigned to that salesperson",
            nextAction:
              "Ask Brain to assign the client to that salesperson, then approve this delegation again",
            responsible: "owner",
          }),
          { status: 409 }
        );
      }
    }

    const { data, error } = await supabaseService.rpc(
      "delegate_brain_work_service",
      {
        p_workspace_id: scope.workspaceId,
        p_actor_user_id: scope.userId,
        p_kind: kind,
        p_record_id: recordId,
        p_assigned_to_user_id: assignedToUserId,
      }
    );
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      assignment: data,
      sourceClosed: kind === "task",
      providerEventTransferred: false,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "The work could not be delegated",
        code: "brain_work_delegation_failed",
      },
      { status: 500 }
    );
  }
}
