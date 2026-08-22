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

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export async function GET() {
  try {
    const scope = requireWorkspaceOwner();
    const [
      { data: companies, error: companiesError },
      grants,
      { data: members, error: membersError },
    ] =
      await Promise.all([
        supabaseService
          .from("companies")
          .select("id,name,sector,stage,profile,updated_at")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .order("updated_at", { ascending: false })
          .limit(1500),
        listVisibleClientGrants(scope.workspaceId),
        supabaseService
          .from("workspace_members")
          .select("user_id,role")
          .eq("workspace_id", scope.workspaceId)
          .eq("status", "active")
          .order("created_at"),
      ]);
    if (companiesError) throw companiesError;
    if (membersError) throw membersError;

    const memberIds = (members || []).map((member: any) => member.user_id);
    const { data: profiles, error: profilesError } = memberIds.length
      ? await supabaseService
          .from("profiles")
          .select("user_id,display_name")
          .in("user_id", memberIds)
      : { data: [] as any[], error: null };
    if (profilesError) throw profilesError;
    const profileById = new Map(
      (profiles || []).map((profile: any) => [profile.user_id, profile])
    );
    const team = (members || []).map((member: any) => ({
      userId: member.user_id,
      role: member.role,
      name:
        (profileById.get(member.user_id) as any)?.display_name ||
        (member.user_id === scope.userId ? "Lee" : "Team member"),
    }));

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
    const grantByCompany = new Map(
      grants.map((grant) => [grant.company_id, grant])
    );

    const records = (companies || [])
      .map((company: any) => ({
        id: company.id,
        name: company.name,
        sector: company.sector || null,
        stage: company.stage || null,
        updatedAt: company.updated_at,
        shared: grantByCompany.get(company.id)?.status === "active",
        assignedToUserId:
          grantByCompany.get(company.id)?.assigned_to_user_id || null,
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
        team,
        currentUser: scope.userId,
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
    const assignedToUserId =
      typeof body.assignedToUserId === "string"
        ? body.assignedToUserId.trim()
        : "";
    if (!companyId) {
      return NextResponse.json(
        { error: "Choose a client record" },
        { status: 400 }
      );
    }
    if (shared && !UUID.test(assignedToUserId)) {
      return NextResponse.json(
        { error: "Choose the salesperson responsible for this client" },
        { status: 400 }
      );
    }

    if (shared) {
      const { data: assignee, error: assigneeError } = await supabaseService
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("user_id", assignedToUserId)
        .eq("status", "active")
        .maybeSingle();
      if (assigneeError) throw assigneeError;
      if (!assignee) {
        return NextResponse.json(
          { error: "Choose an active member of your sales team" },
          { status: 400 }
        );
      }
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

    // One security-invoker database transaction changes the safe client grant
    // and its open revenue work. A failure cannot leave either half saved.
    const { data: saved, error: saveError } = await supabaseService.rpc(
      "set_team_client_sales_assignment_service",
      {
        p_actor_user_id: scope.userId,
        p_company_id: companyId,
        p_shared: shared,
        p_assigned_to_user_id: shared ? assignedToUserId : null,
      }
    );
    if (saveError) throw saveError;
    if (!saved || saved.companyId !== companyId || saved.shared !== shared) {
      throw new Error("The database did not confirm the complete assignment");
    }

    return NextResponse.json(
      {
        companyId,
        shared: saved.shared === true,
        assignedToUserId: saved.assignedToUserId || null,
        assignedAt: saved.assignedAt || null,
        opportunitiesUpdated: saved.opportunitiesUpdated || 0,
        updatedAt: saved.updatedAt,
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
