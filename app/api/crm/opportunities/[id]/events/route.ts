import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { loadVisibleOpportunityById } from "@/lib/opportunity-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const opportunity = await loadVisibleOpportunityById(
      scope,
      params.id,
      "id,workspace_id,owner_id,visibility,opportunity_type,assigned_to_user_id,company_id"
    );
    if (!opportunity)
      return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
    const { data, error } = await supabaseAdmin
      .from("opportunity_events")
      .select("id,event_type,source_type,source_channel,rationale,created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("opportunity_id", params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ events: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not load opportunity history" },
      { status: 500 }
    );
  }
}
