import { NextRequest, NextResponse } from "next/server";

import { requireWorkspaceOwner } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import {
  listVisibleClientGrants,
  sharedClientBlockReason,
} from "@/lib/team-client-sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function GET() {
  try {
    const scope = requireWorkspaceOwner();
    const [{ data: companies, error: companiesError }, grants] =
      await Promise.all([
        supabaseService
          .from("companies")
          .select("id,name,sector,stage,profile,updated_at")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .order("updated_at", { ascending: false })
          .limit(1500),
        listVisibleClientGrants(),
      ]);
    if (companiesError) throw companiesError;

    const companyIds = (companies || []).map((company: any) => company.id);
    const { data: opportunities, error: opportunitiesError } = companyIds.length
      ? await supabaseService
          .from("opportunities")
          .select("company_id")
          .eq("workspace_id", scope.workspaceId)
          .eq("status", "open")
          .eq("opportunity_type", "revenue")
          .in("company_id", companyIds)
          .or(`owner_id.eq.${scope.userId},visibility.eq.team`)
          .limit(3000)
      : { data: [], error: null };
    if (opportunitiesError) throw opportunitiesError;

    const opportunityCount = new Map<string, number>();
    for (const opportunity of opportunities || []) {
      if (!opportunity.company_id) continue;
      opportunityCount.set(
        opportunity.company_id,
        (opportunityCount.get(opportunity.company_id) || 0) + 1
      );
    }
    const statusByCompany = new Map(
      grants.map((grant) => [grant.company_id, grant.status])
    );

    const records = (companies || [])
      .map((company: any) => ({
        id: company.id,
        name: company.name,
        sector: company.sector || null,
        stage: company.stage || null,
        updatedAt: company.updated_at,
        shared: statusByCompany.get(company.id) === "active",
        openOpportunityCount: opportunityCount.get(company.id) || 0,
        blockedReason: sharedClientBlockReason(company),
      }))
      .sort(
        (a: any, b: any) =>
          Number(b.shared) - Number(a.shared) ||
          String(a.name).localeCompare(String(b.name))
      );

    return NextResponse.json(
      {
        records,
        summary: {
          total: records.length,
          shared: records.filter((record: any) => record.shared).length,
          protected: records.filter((record: any) => record.blockedReason).length,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Client sharing could not be loaded" },
      { status: 403 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const scope = requireWorkspaceOwner();
    const body = await req.json();
    const companyId =
      typeof body.companyId === "string" ? body.companyId.trim() : "";
    const shared = body.shared === true;
    if (!companyId) {
      return NextResponse.json(
        { error: "Choose a client record" },
        { status: 400 }
      );
    }

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id,name,stage,sector,profile,workspace_id,owner_id")
      .eq("id", companyId)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company) {
      return NextResponse.json(
        { error: "Only your own client records can be shared" },
        { status: 404 }
      );
    }
    const blockedReason = sharedClientBlockReason(company);
    if (shared && blockedReason) {
      return NextResponse.json({ error: blockedReason }, { status: 409 });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("team_client_shares")
      .select("id,status")
      .eq("workspace_id", scope.workspaceId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingError) throw existingError;

    let saved: any;
    if (existing) {
      const { data, error } = await supabaseAdmin
        .from("team_client_shares")
        .update({ status: shared ? "active" : "revoked" })
        .eq("id", existing.id)
        .select("id,company_id,status,updated_at")
        .single();
      if (error) throw error;
      saved = data;
    } else if (shared) {
      const { data, error } = await supabaseAdmin
        .from("team_client_shares")
        .insert({
          workspace_id: scope.workspaceId,
          company_id: companyId,
          shared_by_user_id: scope.userId,
          status: "active",
        })
        .select("id,company_id,status,updated_at")
        .single();
      if (error) throw error;
      saved = data;
    } else {
      return NextResponse.json({ companyId, shared: false });
    }

    return NextResponse.json(
      {
        companyId,
        shared: saved.status === "active",
        updatedAt: saved.updated_at,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Client sharing did not save" },
      { status: 500 }
    );
  }
}
