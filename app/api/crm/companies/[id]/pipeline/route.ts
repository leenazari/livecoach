import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { loadVisibleOpportunities } from "@/lib/opportunity-access";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

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
