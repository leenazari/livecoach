import { NextRequest, NextResponse } from "next/server";
import { findDuplicateCompanies } from "@/lib/crm-health";
import { requireWorkspaceOwner, type RequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COUNT_SOURCES = [
  { key: "contacts", table: "contacts", column: "company_id" },
  { key: "calls", table: "interview_sessions", column: "company_id" },
  { key: "summaries", table: "interview_summaries", column: "company_id" },
  { key: "opportunities", table: "opportunities", column: "company_id" },
  { key: "followUps", table: "follow_ups", column: "company_id" },
  { key: "tasks", table: "tasks", column: "company_id" },
  { key: "context", table: "client_context", column: "company_id" },
  { key: "brainMessages", table: "assistant_messages", column: "company_id" },
  { key: "upcomingCalls", table: "upcoming_calls", column: "company_id" },
  { key: "outreach", table: "outreach_prospects", column: "crm_company_id" },
  { key: "emailLinks", table: "contact_company_overrides", column: "company_id" },
  { key: "externalRefs", table: "external_refs", column: "entity_id", extra: ["entity_type", "company"] },
  { key: "prioritySetting", table: "company_priority", column: "company_id" },
] as const;

type PairCompany = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  sector: string | null;
  stage: string | null;
  notes: string | null;
  profile: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
  email_context: string | null;
  commercial_memory: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function validateIds(keepId: string, mergeId: string) {
  if (!UUID_RE.test(keepId) || !UUID_RE.test(mergeId) || keepId === mergeId) {
    throw new Error("Choose two different valid client records");
  }
}

async function loadPair(
  scope: Pick<RequestScope, "userId" | "workspaceId">,
  keepId: string,
  mergeId: string
) {
  validateIds(keepId, mergeId);
  const [{ data: companies, error: companyError }, { data: contacts, error: contactError }] =
    await Promise.all([
      supabaseAdmin
        .from("companies")
        .select(
          "id,name,domain,website,sector,stage,notes,profile,attributes,email_context,commercial_memory,created_at,updated_at"
        )
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .in("id", [keepId, mergeId]),
      supabaseAdmin
        .from("contacts")
        .select("company_id,email")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .in("company_id", [keepId, mergeId])
        .limit(1000),
    ]);
  if (companyError) throw companyError;
  if (contactError) throw contactError;
  if (!companies || companies.length !== 2) {
    const error = new Error("One of these client records no longer exists");
    (error as any).status = 404;
    throw error;
  }

  const duplicate = findDuplicateCompanies(companies, contacts || [], 5).find(
    (item) => item.records.some((record) => record.id === keepId) &&
      item.records.some((record) => record.id === mergeId)
  );
  if (!duplicate) {
    const error = new Error("These records no longer meet the safe duplicate rules");
    (error as any).status = 409;
    throw error;
  }

  const byId = new Map(
    (companies as PairCompany[]).map((company) => [company.id, company])
  );
  return {
    keep: byId.get(keepId)!,
    merge: byId.get(mergeId)!,
    reason: duplicate.reason,
  };
}

async function recordCounts(
  scope: Pick<RequestScope, "userId" | "workspaceId">,
  companyId: string
) {
  const rows = await Promise.all(
    COUNT_SOURCES.map(async (source) => {
      let query = supabaseAdmin
        .from(source.table)
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq(source.column, companyId);
      if ("extra" in source) query = query.eq(source.extra[0], source.extra[1]);
      const { count, error } = await query;
      if (error) throw error;
      return [source.key, count || 0] as const;
    })
  );
  return Object.fromEntries(rows) as Record<(typeof COUNT_SOURCES)[number]["key"], number>;
}

function reviewRecord(company: PairCompany, counts: Awaited<ReturnType<typeof recordCounts>>) {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    website: company.website,
    sector: company.sector,
    stage: company.stage,
    createdAt: company.created_at,
    updatedAt: company.updated_at,
    hasNotes: !!company.notes?.trim(),
    hasEmailContext: !!company.email_context?.trim(),
    hasBrainMemory:
      !!company.commercial_memory && Object.keys(company.commercial_memory).length > 0,
    hasProfile: !!company.profile && Object.keys(company.profile).length > 0,
    customFields: company.attributes ? Object.keys(company.attributes).length : 0,
    counts,
    linkedRecords: Object.values(counts).reduce((total, count) => total + count, 0),
  };
}

export async function GET(req: NextRequest) {
  try {
    const scope = requireWorkspaceOwner();
    const keepId = req.nextUrl.searchParams.get("keepId") || "";
    const mergeId = req.nextUrl.searchParams.get("mergeId") || "";
    const pair = await loadPair(scope, keepId, mergeId);
    const [keepCounts, mergeCounts] = await Promise.all([
      recordCounts(scope, keepId),
      recordCounts(scope, mergeId),
    ]);

    return NextResponse.json(
      {
        reason: pair.reason,
        keep: reviewRecord(pair.keep, keepCounts),
        merge: reviewRecord(pair.merge, mergeCounts),
      },
      { headers: noStore }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to prepare duplicate review" },
      { status: err?.status || 400, headers: noStore }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = requireWorkspaceOwner();
    const body = await req.json();
    const keepId = String(body.keepId || "");
    const mergeId = String(body.mergeId || "");
    const pair = await loadPair(scope, keepId, mergeId);

    if (body.confirmed !== true || String(body.confirmName || "") !== pair.keep.name) {
      return NextResponse.json(
        { error: "Confirm the client name you want to keep before merging" },
        { status: 400, headers: noStore }
      );
    }
    if (
      String(body.expectedKeepUpdatedAt || "") !== pair.keep.updated_at ||
      String(body.expectedMergeUpdatedAt || "") !== pair.merge.updated_at
    ) {
      return NextResponse.json(
        { error: "One of these clients changed after the review. Refresh and review again." },
        { status: 409, headers: noStore }
      );
    }

    const rpcName = pair.reason.includes("saved alias matches name")
      ? "merge_crm_companies_by_alias"
      : "merge_crm_companies";
    const { data, error } = await supabaseAdmin.rpc(rpcName, {
      p_keep_id: keepId,
      p_merge_id: mergeId,
      p_expected_keep_updated_at: pair.keep.updated_at,
      p_expected_merge_updated_at: pair.merge.updated_at,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, result: data }, { headers: noStore });
  } catch (err: any) {
    const message = err?.message || "failed to merge duplicate clients";
    const status = /changed|no longer meet/i.test(message)
      ? 409
      : /no longer exists/i.test(message)
        ? 404
        : err?.status || 500;
    return NextResponse.json({ error: message }, { status, headers: noStore });
  }
}
