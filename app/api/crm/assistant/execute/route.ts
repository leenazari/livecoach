import { NextRequest, NextResponse } from "next/server";

import {
  brainAuthorityProfile,
  brainRoleMayExecute,
  verifyBrainActionToken,
} from "@/lib/brain-authority";
import { brainTrustDecision } from "@/lib/brain-control";
import { requireRequestScope, type RequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

const OWNER_OVERRIDABLE_BLOCKERS = new Set([
  "outreach_crm_relationship_ineligible",
  "outreach_cross_campaign_cooldown",
  "outreach_existing_campaign_enrolment",
  "outreach_paused_campaign_enrolment",
]);

const cleanObject = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const finiteCost = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(100, Number(number.toFixed(6)));
};

function recordedActionCost(data: Record<string, any>) {
  const candidates = [
    data.actualCostGbp,
    data.costGbp,
    data.estimatedCostGbp,
    data.job?.costGbp,
    data.job?.cost_gbp,
    data.message?.voice_estimated_cost_gbp,
  ];
  return candidates.reduce(
    (highest, value) => Math.max(highest, finiteCost(value)),
    0
  );
}

async function responseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return cleanObject(JSON.parse(text));
  } catch {
    return { error: text.slice(0, 2000) };
  }
}

async function callAction(input: {
  request: NextRequest;
  token: string;
  endpoint: string;
  method: string;
  body: Record<string, unknown>;
  ownerOverride: boolean;
}) {
  const cookie = input.request.headers.get("cookie") || "";
  const response = await fetch(`${input.request.nextUrl.origin}${input.endpoint}`, {
    method: input.method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(input.ownerOverride
        ? { "x-livecoach-brain-action": input.token }
        : {}),
    },
    body: JSON.stringify(input.body),
  });
  return { response, data: await responseJson(response) };
}

async function captureBeforeState(scope: RequestScope, endpoint: string) {
  const readableEndpoint = endpoint.endsWith("/cancel")
    ? endpoint.slice(0, -"/cancel".length)
    : endpoint;
  const match = readableEndpoint.match(
    /^\/api\/crm\/(upcoming|tasks|companies|contacts|opportunities|outreach\/campaigns)\/([0-9a-f-]+)$/i
  );
  if (!match) return {};
  const table =
    match[1] === "upcoming"
      ? "upcoming_calls"
      : match[1] === "outreach/campaigns"
        ? "outreach_campaigns"
        : match[1];
  const fields: Record<string, string> = {
    upcoming_calls:
      "id,title,scheduled_at,meeting_url,intent,prepped,prep,completed_at,company_id,workstream_id,source,external_id",
    tasks: "id,text,status,due_at,payload,link_kind,company_id",
    companies: "id,name,domain,website,sector,stage,notes,email_context,owner_id",
    contacts: "id,name,role,email,sector,notes,company_id,owner_id",
    opportunities:
      "id,title,detail,value,status,pipeline_stage,probability,forecast_category,expected_close_at,next_action,next_action_due_at,next_action_owner,assigned_to_user_id,owner_id",
    outreach_campaigns:
      "id,name,goal,audience,offer_angle,daily_limit,status,voice,banned_phrases,booking_cta_mode,cta_config,sequence,owner_id,visibility",
  };
  let query = supabaseService
    .from(table)
    .select(fields[table])
    .eq("workspace_id", scope.workspaceId)
    .eq("id", match[2]);
  if (["upcoming_calls", "tasks", "companies", "contacts"].includes(table)) {
    query = query.eq("owner_id", scope.userId);
  } else if (table === "opportunities" && scope.role !== "owner") {
    query = query.or(
      `owner_id.eq.${scope.userId},assigned_to_user_id.eq.${scope.userId}`
    );
  }
  const { data, error } = await query.maybeSingle();
  if (error || !data) return {};
  return { record: data };
}

function deriveUndo(action: any, beforeState: Record<string, any>) {
  if (action.method !== "PATCH" || action.body?.updateCalendar === true) return null;
  const row = beforeState?.record;
  if (!row || typeof row !== "object") return null;
  const body: Record<string, unknown> = {};
  if (/^\/api\/crm\/tasks\//.test(action.endpoint)) {
    if ("status" in action.body) body.status = row.status;
    if ("text" in action.body) body.text = row.text;
    if ("dueAt" in action.body) body.dueAt = row.due_at;
    if ("action" in action.body) {
      body.action = ["email", "call", "drafts"].includes(row.link_kind)
        ? row.link_kind
        : "task";
    }
  } else if (/^\/api\/crm\/upcoming\//.test(action.endpoint)) {
    if ("title" in action.body) body.title = row.title || "";
    if ("scheduledAt" in action.body) body.scheduledAt = row.scheduled_at;
    if ("meetingUrl" in action.body) body.meetingUrl = row.meeting_url || "";
    if ("intent" in action.body || "appendIntentNote" in action.body) {
      body.intent = row.intent || "";
      body.intentSource = "manual";
    }
    if ("appendIntentNote" in action.body || "prep" in action.body) body.prep = row.prep;
    if ("prepped" in action.body || "appendIntentNote" in action.body)
      body.prepped = row.prepped;
    if ("companyId" in action.body) body.companyId = row.company_id;
    if ("workstreamId" in action.body) body.workstreamId = row.workstream_id;
    if ("completed" in action.body) body.completed = !row.completed_at ? false : true;
  } else if (/^\/api\/crm\/companies\//.test(action.endpoint)) {
    for (const key of [
      "name",
      "domain",
      "website",
      "sector",
      "stage",
      "notes",
      "email_context",
    ]) {
      if (key in action.body) body[key] = row[key] ?? "";
    }
  } else if (/^\/api\/crm\/contacts\//.test(action.endpoint)) {
    for (const key of ["name", "role", "email", "sector", "notes"]) {
      if (key in action.body) body[key] = row[key] ?? "";
    }
  } else if (/^\/api\/crm\/outreach\/campaigns\//.test(action.endpoint)) {
    for (const key of [
      "name",
      "goal",
      "audience",
      "offer_angle",
      "daily_limit",
      "status",
      "voice",
      "banned_phrases",
      "booking_cta_mode",
      "cta_config",
      "sequence",
    ]) {
      if (key in action.body) body[key] = row[key];
    }
  }
  if (!Object.keys(body).length) return null;
  return {
    endpoint: action.endpoint,
    method: "PATCH",
    body,
    label: `Undo ${String(action.label || action.type).slice(0, 900)}`,
  };
}

async function existingExecution(input: {
  workspaceId: string;
  actorUserId: string;
  key: string;
}) {
  const { data, error } = await supabaseService
    .from("brain_action_executions")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("actor_user_id", input.actorUserId)
    .eq("idempotency_key", input.key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function POST(request: NextRequest) {
  let executionId = "";
  let retryAllowed = false;
  let actionCompleted = false;
  let completedActionPayload: Record<string, any> = {};
  try {
    const scope = requireRequestScope();
    if (scope.status !== "active") {
      return NextResponse.json(
        { error: "Active workspace access is required" },
        { status: 403, headers: noStore }
      );
    }
    const input = await request.json().catch(() => ({}));
    if (input?.confirmed !== true) {
      return NextResponse.json(
        { error: "Review and confirm the exact Brain action first" },
        { status: 400, headers: noStore }
      );
    }
    const token = String(input?.token || "");
    const payload = verifyBrainActionToken(token, scope);
    const profile = brainAuthorityProfile(payload.actionType);
    retryAllowed = profile.canRetry;
    if (!brainRoleMayExecute(scope, profile)) {
      return NextResponse.json(
        {
          error:
            profile.ownerOnly
              ? "Only the workspace owner can approve this action"
              : "This role cannot approve this Brain action",
          code: "brain_role_not_permitted",
        },
        { status: 403, headers: noStore }
      );
    }

    const existing = await existingExecution({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      key: payload.jti,
    });
    if (existing?.status === "completed") {
      return NextResponse.json(
        {
          ...cleanObject(existing.response_payload),
          ok: true,
          executionId: existing.id,
          reused: true,
          recovery: existing.recovery || {},
        },
        { headers: noStore }
      );
    }
    if (existing?.status === "running") {
      const age = Date.now() - new Date(existing.updated_at).getTime();
      if (Number.isFinite(age) && age < 120_000) {
        return NextResponse.json(
          {
            error: "This Brain action is already being completed",
            code: "brain_action_in_progress",
            executionId: existing.id,
          },
          { status: 409, headers: noStore }
        );
      }
    }
    if (existing && !profile.canRetry) {
      return NextResponse.json(
        {
          error: "This action cannot be retried safely. Prepare and review a fresh action instead",
          code: "brain_action_fresh_approval_required",
          executionId: existing.id,
        },
        { status: 409, headers: noStore }
      );
    }

    const trust = await brainTrustDecision(scope, profile.actionKind);
    const ownerOverrideAllowed =
      scope.role === "owner" &&
      payload.ownerOverrideRequested &&
      profile.canOwnerOverride;
    if (trust.mode === "blocked" && !ownerOverrideAllowed) {
      const blockedValues = {
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        actor_role: scope.role,
        action_type: payload.actionType,
        action_kind: profile.actionKind,
        label: payload.action.label,
        target_endpoint: payload.action.endpoint,
        request_method: payload.action.method,
        status: "blocked",
        policy_decision: "blocked",
        owner_override_requested: payload.ownerOverrideRequested,
        owner_override_applied: false,
        idempotency_key: payload.jti,
        request_payload: payload.action.body,
        estimated_cost_gbp: finiteCost(payload.action.estimatedCostGbp),
        actual_cost_gbp: 0,
        recovery: { canRetry: false, canUndo: false },
        blocker_code: "brain_trust_rule_blocked",
        error: trust.reason || "This Brain action is blocked by its trust rule",
        completed_at: new Date().toISOString(),
      };
      const { data: blocked } = await supabaseService
        .from("brain_action_executions")
        .upsert(blockedValues, {
          onConflict: "workspace_id,actor_user_id,idempotency_key",
        })
        .select("id")
        .single();
      return NextResponse.json(
        {
          error: blockedValues.error,
          code: blockedValues.blocker_code,
          executionId: blocked?.id || null,
        },
        { status: 403, headers: noStore }
      );
    }

    const beforeState = await captureBeforeState(scope, payload.action.endpoint);
    if (existing) {
      const { data, error } = await supabaseService
        .from("brain_action_executions")
        .update({
          status: "running",
          policy_decision: ownerOverrideAllowed ? "owner_override" : "confirmed",
          owner_override_requested: payload.ownerOverrideRequested,
          owner_override_applied: false,
          attempt_count: Number(existing.attempt_count || 1) + 1,
          before_state: beforeState,
          estimated_cost_gbp: finiteCost(payload.action.estimatedCostGbp),
          actual_cost_gbp: 0,
          response_payload: {},
          blocker_code: null,
          error: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        })
        .eq("id", existing.id)
        .select("id")
        .single();
      if (error) throw error;
      executionId = data.id;
    } else {
      const { data, error } = await supabaseService
        .from("brain_action_executions")
        .insert({
          workspace_id: scope.workspaceId,
          actor_user_id: scope.userId,
          actor_role: scope.role,
          action_type: payload.actionType,
          action_kind: profile.actionKind,
          label: payload.action.label,
          target_endpoint: payload.action.endpoint,
          request_method: payload.action.method,
          status: "running",
          policy_decision: ownerOverrideAllowed ? "owner_override" : "confirmed",
          owner_override_requested: payload.ownerOverrideRequested,
          owner_override_applied: false,
          idempotency_key: payload.jti,
          request_payload: payload.action.body,
          before_state: beforeState,
          estimated_cost_gbp: finiteCost(payload.action.estimatedCostGbp),
          actual_cost_gbp: 0,
          recovery: { canRetry: profile.canRetry, canUndo: false },
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") {
          const raced = await existingExecution({
            workspaceId: scope.workspaceId,
            actorUserId: scope.userId,
            key: payload.jti,
          });
          if (raced?.status === "completed") {
            return NextResponse.json(
              {
                ...cleanObject(raced.response_payload),
                ok: true,
                executionId: raced.id,
                reused: true,
                recovery: raced.recovery || {},
              },
              { headers: noStore }
            );
          }
        }
        throw error;
      }
      executionId = data.id;
    }

    let result = await callAction({
      request,
      token,
      endpoint: payload.action.endpoint,
      method: payload.action.method,
      body: payload.action.body,
      ownerOverride: false,
    });
    let overrideApplied = false;
    const blockerCode = String(result.data?.code || result.data?.blocker?.code || "");
    if (
      !result.response.ok &&
      result.response.status === 409 &&
      ownerOverrideAllowed &&
      OWNER_OVERRIDABLE_BLOCKERS.has(blockerCode)
    ) {
      result = await callAction({
        request,
        token,
        endpoint: payload.action.endpoint,
        method: payload.action.method,
        body: payload.action.body,
        ownerOverride: true,
      });
      overrideApplied = result.response.ok;
    }

    const completed = result.response.ok && result.data?.ok !== false;
    actionCompleted = completed;
    completedActionPayload = result.data;
    const finalBlocker = String(
      result.data?.code || result.data?.blocker?.code || ""
    ).slice(0, 160);
    const errorMessage = String(
      result.data?.error ||
        result.data?.reason ||
        (completed ? "" : `The action returned HTTP ${result.response.status}`)
    ).slice(0, 2000);
    const undo = completed ? deriveUndo(payload.action, beforeState) : null;
    const actualCostGbp = recordedActionCost(result.data);
    const recovery = {
      canRetry: !completed && profile.canRetry,
      canUndo: Boolean(undo),
      ...(undo
        ? {
            undo,
            undoUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
          }
        : {}),
      nextAction:
        result.data?.nextAction ||
        result.data?.blocker?.nextAction ||
        (!completed && profile.canRetry
          ? "Press retry on this exact action after resolving the blocker"
          : null),
    };
    const { error: auditError } = await supabaseService
      .from("brain_action_executions")
      .update({
        status: completed ? "completed" : "failed",
        owner_override_applied: overrideApplied,
        response_payload: result.data,
        actual_cost_gbp: actualCostGbp,
        recovery,
        blocker_code: finalBlocker || null,
        error: errorMessage || null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", executionId)
      .eq("workspace_id", scope.workspaceId)
      .eq("actor_user_id", scope.userId);
    if (auditError) {
      const pendingRecovery = {
        canRetry: false,
        canUndo: false,
        nextAction:
          "The action completed. Refresh the exact record before doing anything else while LiveCoach reconciles its audit receipt",
      };
      if (completed) {
        return NextResponse.json(
          {
            ...result.data,
            ok: true,
            executionId,
            ownerOverrideApplied: overrideApplied,
            actionCompleted: true,
            auditConfirmed: false,
            warning:
              "The action completed, but its central audit receipt is still pending",
            recovery: pendingRecovery,
          },
          { status: 202, headers: noStore }
        );
      }
      throw auditError;
    }

    return NextResponse.json(
      {
        ...result.data,
        executionId,
        ownerOverrideApplied: overrideApplied,
        auditConfirmed: true,
        recovery,
      },
      { status: result.response.status, headers: noStore }
    );
  } catch (error: any) {
    const message = error?.message || "The Brain action could not be completed";
    if (executionId && !actionCompleted) {
      await supabaseService
        .from("brain_action_executions")
        .update({
          status: "failed",
          error: String(message).slice(0, 2000),
          recovery: {
            canRetry: retryAllowed,
            canUndo: false,
            nextAction: retryAllowed
              ? "Retry this exact action once. If it repeats, open the execution receipt"
              : "Prepare and review a fresh action. This action is not safe to retry",
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", executionId);
    }
    if (actionCompleted) {
      return NextResponse.json(
        {
          ...completedActionPayload,
          ok: true,
          executionId,
          actionCompleted: true,
          auditConfirmed: false,
          warning:
            "The action completed, but its central audit receipt is still pending",
          recovery: {
            canRetry: false,
            canUndo: false,
            nextAction:
              "Refresh the exact record before doing anything else while LiveCoach reconciles its audit receipt",
          },
        },
        { status: 202, headers: noStore }
      );
    }
    const status = /token|expired|another account|changed|authority|permitted|confirm/i.test(
      message
    )
      ? 403
      : 500;
    return NextResponse.json(
      {
        error: message,
        code: "brain_action_execution_failed",
        executionId: executionId || null,
      },
      { status, headers: noStore }
    );
  }
}
