import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { fingerprintTask } from "@/lib/tasks";
import { resolveRecordScope, type RecordScope } from "@/lib/record-scope";
import { opportunityProposalNeedsConfirmation } from "@/lib/opportunity-scope-guard";

type CompanyOpportunityScope = {
  id: string;
  workspace_id: string;
  owner_id: string;
  visibility?: "private" | "team" | null;
};

type RevenueOpportunityDraft = {
  title: string;
  detail?: string | null;
  value?: number | null;
  sessionId?: string | null;
  workstreamId?: string | null;
  clarificationTaskId?: string | null;
  source?: string;
  surfacedByAi?: boolean;
  assignedToUserId?: string | null;
  rationale?: string | null;
  pipelineStage?:
    | "new"
    | "discovery"
    | "qualified"
    | "proposal"
    | "negotiation"
    | "verbal"
    | "won"
    | "lost";
  probability?: number;
};

export type OpportunityScopeClarification = {
  taskId: string | null;
  existingOpportunityId: string;
  existingTitle: string;
  proposedTitle: string;
  proposedDetail: string | null;
  proposedValue: number | null;
  proposedSource: string;
};

export type CanonicalOpportunityResult = {
  opportunity: Record<string, any>;
  created: boolean;
  confirmationRequired: boolean;
  clarification: OpportunityScopeClarification | null;
};

async function createOpportunityClarificationTask(
  company: CompanyOpportunityScope,
  existing: Record<string, any>,
  draft: RevenueOpportunityDraft,
  actor: RecordScope
): Promise<OpportunityScopeClarification | null> {
  const proposedTitle = String(draft.title || "Proposed opportunity")
    .trim()
    .slice(0, 240);
  const existingTitle = String(existing.title || "Existing opportunity")
    .trim()
    .slice(0, 240);
  const text = `Confirm whether \"${proposedTitle}\" is part of \"${existingTitle}\" or a separate buying decision`;
  const ownerId = actor.userId;
  const fingerprint = fingerprintTask(
    company.id,
    `opportunity scope clarification ${existing.id} ${proposedTitle}`,
    draft.sessionId || draft.workstreamId || null
  );
  const payload = {
    clarificationType: "opportunity_scope",
    existingOpportunityId: String(existing.id),
    existingTitle,
    proposedTitle,
    proposedDetail:
      typeof draft.detail === "string" && draft.detail.trim()
        ? draft.detail.trim().slice(0, 1500)
        : null,
    proposedValue:
      typeof draft.value === "number" && Number.isFinite(draft.value)
        ? draft.value
        : null,
    proposedSource: draft.source || "ai",
    proposedSessionId: draft.sessionId || null,
    proposedWorkstreamId: draft.workstreamId || null,
    pinned: true,
  };
  const row = {
    company_id: company.id,
    workstream_id: draft.workstreamId || null,
    text,
    kind: "opportunity_clarification",
    link_kind: "client",
    source: "canonical_opportunity_guard",
    source_ref: draft.sessionId || String(existing.id),
    payload,
    due_at: null,
    fingerprint,
    status: "open",
    owner_id: ownerId,
    workspace_id: company.workspace_id,
    visibility: "private",
  };
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .upsert(row, {
      onConflict: "owner_id,fingerprint",
      ignoreDuplicates: true,
    })
    .select("id,status")
    .maybeSingle();
  if (error) throw error;

  let taskId = data?.id ? String(data.id) : null;
  let taskStatus = data?.status ? String(data.status) : null;
  if (!taskId) {
    const { data: saved, error: savedError } = await supabaseAdmin
      .from("tasks")
      .select("id,status")
      .eq("workspace_id", company.workspace_id)
      .eq("owner_id", ownerId)
      .eq("fingerprint", fingerprint)
      .maybeSingle();
    if (savedError) throw savedError;
    taskId = saved?.id ? String(saved.id) : null;
    taskStatus = saved?.status ? String(saved.status) : null;
  }

  // The same stored source may be processed again by a browser retry or a
  // manual refresh. Once its question has been answered, never resurrect it.
  if (taskStatus && taskStatus !== "open") return null;

  return {
    taskId,
    existingOpportunityId: String(existing.id),
    existingTitle,
    proposedTitle,
    proposedDetail: payload.proposedDetail,
    proposedValue: payload.proposedValue,
    proposedSource: payload.proposedSource,
  };
}

const changedAt = (row: any) =>
  new Date(row.updated_at || row.created_at || 0).getTime();

export function chooseCanonicalOpenRevenueOpportunity<T extends Record<string, any>>(
  rows: T[]
): T | null {
  return [...rows]
    .filter(
      (row) =>
        row.status === "open" &&
        (row.opportunity_type || "revenue") === "revenue"
    )
    .sort((left, right) => {
      const leftHuman = left.surfaced_by_ai !== true ? 1 : 0;
      const rightHuman = right.surfaced_by_ai !== true ? 1 : 0;
      if (leftHuman !== rightHuman) return rightHuman - leftHuman;
      const leftOverride = [
        left.pipeline_stage_override,
        left.win_outlook_override,
        left.deal_intent_override,
        left.next_action_override,
      ].some(Boolean)
        ? 1
        : 0;
      const rightOverride = [
        right.pipeline_stage_override,
        right.win_outlook_override,
        right.deal_intent_override,
        right.next_action_override,
      ].some(Boolean)
        ? 1
        : 0;
      if (leftOverride !== rightOverride) return rightOverride - leftOverride;
      return changedAt(right) - changedAt(left);
    })[0] || null;
}

export async function loadCanonicalOpenRevenueOpportunity(
  companyId: string,
  workstreamId: string | null = null
): Promise<Record<string, any> | null> {
  const actor = await resolveRecordScope();
  let query = supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("workspace_id", actor.workspaceId)
    .eq("company_id", companyId)
    .eq("status", "open")
    .eq("opportunity_type", "revenue")
    .or(
      `owner_id.eq.${actor.userId},assigned_to_user_id.eq.${actor.userId}`
    )
    .order("updated_at", { ascending: false })
    .limit(20);
  query = workstreamId
    ? query.eq("workstream_id", workstreamId)
    : query.is("workstream_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return chooseCanonicalOpenRevenueOpportunity(data || []);
}

export async function createCanonicalOpenRevenueOpportunity(
  company: CompanyOpportunityScope,
  draft: RevenueOpportunityDraft
): Promise<CanonicalOpportunityResult> {
  const actor = await resolveRecordScope();
  if (actor.workspaceId !== company.workspace_id) {
    throw new Error("Cross-workspace opportunity access is not permitted");
  }
  const workstreamId = draft.workstreamId || null;
  const existing = await loadCanonicalOpenRevenueOpportunity(
    company.id,
    workstreamId
  );
  if (existing) {
    if (
      draft.surfacedByAi !== false &&
      opportunityProposalNeedsConfirmation(existing, draft)
    ) {
      const clarification = await createOpportunityClarificationTask(
        company,
        existing,
        draft,
        actor
      );
      return {
        opportunity: existing,
        created: false,
        confirmationRequired: !!clarification,
        clarification,
      };
    }
    return {
      opportunity: existing,
      created: false,
      confirmationRequired: false,
      clarification: null,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .insert({
      company_id: company.id,
      workspace_id: company.workspace_id,
      owner_id: draft.assignedToUserId || actor.userId,
      visibility: company.visibility || "private",
      assigned_to_user_id: draft.assignedToUserId || actor.userId,
      workstream_id: workstreamId,
      session_id: draft.sessionId || null,
      title: draft.title,
      detail: draft.detail || null,
      value: draft.value ?? null,
      status: "open",
      opportunity_type: "revenue",
      ...(draft.pipelineStage
        ? { pipeline_stage: draft.pipelineStage }
        : {}),
      ...(typeof draft.probability === "number" &&
      Number.isFinite(draft.probability)
        ? {
            probability: Math.max(
              0,
              Math.min(100, Math.round(draft.probability))
            ),
          }
        : {}),
      source: draft.source || "call",
      surfaced_by_ai: draft.surfacedByAi !== false,
      last_change_context: {
        nonce: crypto.randomUUID(),
        sourceType: draft.surfacedByAi === false ? "human" : "system",
        sourceChannel: draft.source || "call",
        rationale:
          typeof draft.rationale === "string" && draft.rationale.trim()
            ? draft.rationale.trim().slice(0, 1000)
            : "Created the canonical active revenue opportunity for this relationship scope",
        evidence: {
          sessionId: draft.sessionId || null,
          workstreamId,
          clarificationTaskId: draft.clarificationTaskId || null,
        },
      },
    })
    .select()
    .single();

  if (!error && data)
    return {
      opportunity: data,
      created: true,
      confirmationRequired: false,
      clarification: null,
    };
  if ((error as any)?.code === "23505") {
    const concurrent = await loadCanonicalOpenRevenueOpportunity(
      company.id,
      workstreamId
    );
    if (concurrent) {
      if (
        draft.surfacedByAi !== false &&
        opportunityProposalNeedsConfirmation(concurrent, draft)
      ) {
        const clarification = await createOpportunityClarificationTask(
          company,
          concurrent,
          draft,
          actor
        );
        return {
          opportunity: concurrent,
          created: false,
          confirmationRequired: !!clarification,
          clarification,
        };
      }
      return {
        opportunity: concurrent,
        created: false,
        confirmationRequired: false,
        clarification: null,
      };
    }
    throw new Error(
      "An active opportunity already exists for this client but is not assigned to this account"
    );
  }
  throw error;
}
