import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_UNDO_ENDPOINT =
  /^\/api\/crm\/(?:upcoming|tasks|companies|contacts|outreach\/campaigns)\/[0-9a-f-]+$/i;
const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let execution: any = null;
  try {
    const scope = requireRequestScope();
    const input = await request.json().catch(() => ({}));
    if (!UUID.test(params.id) || input?.confirmed !== true) {
      return NextResponse.json(
        { error: "Confirm the exact completed action to undo it" },
        { status: 400, headers: noStore }
      );
    }
    const { data, error } = await supabaseService
      .from("brain_action_executions")
      .select("*")
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("actor_user_id", scope.userId)
      .maybeSingle();
    if (error) throw error;
    execution = data;
    if (!execution || execution.status !== "completed") {
      return NextResponse.json(
        { error: "That completed Brain action is not available to your account" },
        { status: 404, headers: noStore }
      );
    }
    if (execution.undone_at) {
      return NextResponse.json(
        {
          ok: true,
          undone: true,
          reused: true,
          executionId: execution.id,
          recovery: execution.recovery,
        },
        { headers: noStore }
      );
    }
    const recovery = object(execution.recovery);
    const undo = object(recovery.undo);
    const undoUntil = new Date(String(recovery.undoUntil || "")).getTime();
    if (
      recovery.canUndo !== true ||
      !Number.isFinite(undoUntil) ||
      undoUntil < Date.now() ||
      undo.method !== "PATCH" ||
      undo.endpoint !== execution.target_endpoint ||
      !INTERNAL_UNDO_ENDPOINT.test(String(undo.endpoint || "")) ||
      !undo.body ||
      typeof undo.body !== "object" ||
      Array.isArray(undo.body) ||
      Buffer.byteLength(JSON.stringify(undo.body), "utf8") > 60_000
    ) {
      return NextResponse.json(
        {
          error: "The ten minute undo window has ended or this action is not reversible",
          code: "brain_undo_unavailable",
        },
        { status: 409, headers: noStore }
      );
    }

    const now = new Date().toISOString();
    const staleClaim = new Date(Date.now() - 2 * 60_000).toISOString();
    const { data: claimed, error: claimError } = await supabaseService
      .from("brain_action_executions")
      .update({ undo_started_at: now })
      .eq("id", execution.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("actor_user_id", scope.userId)
      .is("undone_at", null)
      .or(`undo_started_at.is.null,undo_started_at.lt.${staleClaim}`)
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      return NextResponse.json(
        { error: "This undo is already being completed", code: "brain_undo_in_progress" },
        { status: 409, headers: noStore }
      );
    }

    const cookie = request.headers.get("cookie") || "";
    const response = await fetch(
      `${request.nextUrl.origin}${undo.endpoint}`,
      {
        method: "PATCH",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(undo.body),
      }
    );
    const text = await response.text();
    let responseBody: Record<string, any> = {};
    try {
      responseBody = text ? object(JSON.parse(text)) : {};
    } catch {
      responseBody = { error: text.slice(0, 2000) };
    }
    if (!response.ok || responseBody.ok === false) {
      const message = String(
        responseBody.error || `The undo returned HTTP ${response.status}`
      ).slice(0, 2000);
      await supabaseService
        .from("brain_action_executions")
        .update({
          undo_started_at: null,
          undo_response: responseBody,
          recovery: {
            ...recovery,
            canUndo: Date.now() < undoUntil,
            undoError: message,
          },
        })
        .eq("id", execution.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("actor_user_id", scope.userId);
      return NextResponse.json(
        {
          error: message,
          code: "brain_undo_not_confirmed",
          recovery: {
            canRetry: Date.now() < undoUntil,
            nextAction: "Refresh the record before retrying this undo",
          },
        },
        { status: response.status || 500, headers: noStore }
      );
    }

    const { undo: _completedUndo, ...recoveryWithoutUndo } = recovery;
    const finalRecovery = {
      ...recoveryWithoutUndo,
      canUndo: false,
      canRetry: false,
      undoneAt: new Date().toISOString(),
      nextAction: null,
    };
    const { error: saveError } = await supabaseService
      .from("brain_action_executions")
      .update({
        undone_at: finalRecovery.undoneAt,
        undo_response: responseBody,
        recovery: finalRecovery,
      })
      .eq("id", execution.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("actor_user_id", scope.userId);
    if (saveError) throw saveError;
    return NextResponse.json(
      {
        ok: true,
        undone: true,
        executionId: execution.id,
        result: responseBody,
        recovery: finalRecovery,
      },
      { headers: noStore }
    );
  } catch (error: any) {
    if (execution?.id) {
      await supabaseService
        .from("brain_action_executions")
        .update({ undo_started_at: null })
        .eq("id", execution.id);
    }
    return NextResponse.json(
      {
        error: error?.message || "The Brain action could not be undone",
        code: "brain_undo_failed",
      },
      { status: 500, headers: noStore }
    );
  }
}
