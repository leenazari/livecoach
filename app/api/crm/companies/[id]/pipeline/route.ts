import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { loadVisibleOpportunities } from "@/lib/opportunity-access";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { parsePipelineEntry } from "@/lib/pipeline-entry";
import { activeCompanyPipelineExclusion } from "@/lib/company-pipeline-exclusion";
import { createCanonicalOpenRevenueOpportunity } from "@/lib/canonical-opportunity";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// POST /api/crm/companies/:id/pipeline -> explicitly promote one permitted
// client relationship into the canonical sales pipeline. This is intentionally
// separate from the company's relationship stage. It is idempotent, creates no
// speculative value or probability. Explicit user-supplied values and open
// stages are accepted from the Pipeline form as well as confirmed Brain actions.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const access = await loadAssignedClientAccess(params.id, scope);
    if (!access) {
      return NextResponse.json(
        { error: "This client is not owned by or assigned to your account" },
        { status: 404 }
      );
    }
    const body = await req.json().catch(() => null);
    const entry = parsePipelineEntry(body);
    if (!entry.ok) return NextResponse.json({ error: entry.error }, { status: 400 });
    const { data: companyProfile, error: profileError } = await supabaseAdmin
      .from("companies").select("profile")
      .eq("workspace_id", scope.workspaceId).eq("id", params.id).maybeSingle();
    if (profileError) throw profileError;
    if (activeCompanyPipelineExclusion(companyProfile?.profile)) {
      return NextResponse.json({ error: "This client was removed from the sales pipeline. Review that decision on the client record before adding an opportunity." }, { status: 409 });
    }
    const suppliedTitle =
      typeof body.title === "string" ? body.title.trim().slice(0, 240) : "";
    const title = suppliedTitle || `${access.company.name} sales opportunity`;
    const rationale =
      typeof body.rationale === "string"
        ? body.rationale.trim().slice(0, 1000)
        : "The signed-in user explicitly confirmed that this relationship belongs in their pipeline";

    const result = await createCanonicalOpenRevenueOpportunity(
      access.company,
      {
        title,
        source: "brain_confirmed_pipeline_promotion",
        surfacedByAi: false,
        assignedToUserId: scope.userId,
        rationale,
        pipelineStage: entry.pipelineStage,
        value: entry.value,
        probability: 0,
      }
    );

    return NextResponse.json({
      opportunity: result.opportunity,
      created: result.created,
      alreadyPresent: !result.created,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to add client to pipeline" },
      { status: 500 }
    );
  }
}

// GET /api/crm/companies/:id/pipeline -> AI-surfaced opportunities + follow-up
// drafts for this company (newest first). Powers the company page's pipeline.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    let followUpsQuery: any = supabaseAdmin
        .from("follow_ups")
        .select("*")
        .eq("workspace_id", scope.workspaceId)
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(20);
    if (scope.role !== "owner")
      followUpsQuery = followUpsQuery.eq("owner_id", scope.userId);
    const [visibleOpportunities, { data: followUps }] = await Promise.all([
      loadVisibleOpportunities(scope, {
        orderBy: "created_at",
        ascending: false,
        companyId: params.id,
        limit: 100,
      }),
      followUpsQuery,
    ]);
    const opportunities = visibleOpportunities.slice(0, 50);
    return NextResponse.json({
      opportunities: opportunities || [],
      followUps: followUps || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load pipeline" },
      { status: 500 }
    );
  }
}
