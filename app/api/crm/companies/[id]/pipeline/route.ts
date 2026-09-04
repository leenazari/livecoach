import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { loadVisibleOpportunities } from "@/lib/opportunity-access";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { createCanonicalOpenRevenueOpportunity } from "@/lib/canonical-opportunity";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// POST /api/crm/companies/:id/pipeline -> explicitly promote one permitted
// client relationship into the canonical sales pipeline. This is intentionally
// separate from the company's relationship stage. It is idempotent, creates no
// speculative value or probability, and is used only after the user confirms
// the exact Brain action.
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
    const body = await req.json().catch(() => ({}));
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
        pipelineStage: "new",
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
