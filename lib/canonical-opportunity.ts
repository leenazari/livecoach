import "server-only";

import { supabaseAdmin } from "@/lib/supabase";

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
  source?: string;
  surfacedByAi?: boolean;
};

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
        left.next_action_override,
      ].some(Boolean)
        ? 1
        : 0;
      const rightOverride = [
        right.pipeline_stage_override,
        right.win_outlook_override,
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
  let query = supabaseAdmin
    .from("opportunities")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "open")
    .eq("opportunity_type", "revenue")
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
): Promise<{ opportunity: Record<string, any>; created: boolean }> {
  const workstreamId = draft.workstreamId || null;
  const existing = await loadCanonicalOpenRevenueOpportunity(
    company.id,
    workstreamId
  );
  if (existing) return { opportunity: existing, created: false };

  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .insert({
      company_id: company.id,
      workspace_id: company.workspace_id,
      owner_id: company.owner_id,
      visibility: company.visibility || "private",
      assigned_to_user_id: company.owner_id,
      workstream_id: workstreamId,
      session_id: draft.sessionId || null,
      title: draft.title,
      detail: draft.detail || null,
      value: draft.value ?? null,
      status: "open",
      opportunity_type: "revenue",
      source: draft.source || "call",
      surfaced_by_ai: draft.surfacedByAi !== false,
      last_change_context: {
        nonce: crypto.randomUUID(),
        sourceType: draft.surfacedByAi === false ? "human" : "system",
        sourceChannel: draft.source || "call",
        rationale: "Created the canonical active revenue opportunity for this relationship scope",
        evidence: {
          sessionId: draft.sessionId || null,
          workstreamId,
        },
      },
    })
    .select()
    .single();

  if (!error && data) return { opportunity: data, created: true };
  if ((error as any)?.code === "23505") {
    const concurrent = await loadCanonicalOpenRevenueOpportunity(
      company.id,
      workstreamId
    );
    if (concurrent) return { opportunity: concurrent, created: false };
  }
  throw error;
}
