import { NextRequest, NextResponse } from "next/server";

import { isUntouchedOutreachAssignment } from "@/lib/outreach-assignment";
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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function prospectName(prospect: any): string {
  return [prospect.first_name, prospect.last_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ") || "Unnamed prospect";
}

function prospectSource(prospect: any): string | null {
  const metadata =
    prospect.source_metadata && typeof prospect.source_metadata === "object"
      ? prospect.source_metadata
      : {};
  const explicit = [
    metadata.campaign,
    metadata.cohort,
    metadata.integration,
    metadata.technology,
    metadata.tag,
    metadata.ringleads?.source,
    prospect.source_file,
    prospect.source_sheet,
  ].find((value) => typeof value === "string" && value.trim());
  return explicit ? String(explicit).trim().replace(/\.(xlsx|xls|csv)$/i, "") : null;
}

export async function GET() {
  try {
    const scope = requireWorkspaceOwner();
    const [
      { data: companies, error: companiesError },
      grants,
      { data: members, error: membersError },
      { data: prospects, error: prospectsError },
      { data: candidateResearch, error: candidateResearchError },
    ] =
      await Promise.all([
        supabaseService
          .from("companies")
          .select("id,name,sector,stage,profile,is_confidential,updated_at")
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
        supabaseAdmin
          .from("outreach_prospects")
          .select(
            "id,email,first_name,last_name,job_title,company_name,priority,priority_score,status,assigned_to_user_id,last_researched_at,last_contacted_at,last_reply_at,source_file,source_sheet,source_metadata,updated_at"
          )
          .eq("workspace_id", scope.workspaceId)
          .order("priority_score", { ascending: false })
          .order("company_name", { ascending: true })
          .limit(1000),
        supabaseAdmin
          .from("outreach_prospects")
          .select("id,research")
          .eq("workspace_id", scope.workspaceId)
          .eq("status", "imported")
          .is("last_researched_at", null)
          .is("last_contacted_at", null)
          .is("last_reply_at", null)
          .limit(1000),
      ]);
    if (companiesError) throw companiesError;
    if (membersError) throw membersError;
    if (prospectsError) throw prospectsError;
    if (candidateResearchError) throw candidateResearchError;

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
    const companyIds = (companies || []).map((company: any) => company.id);
    const [
      opportunitiesResult,
      messagesResult,
      enrolmentsResult,
    ] = await Promise.all([
      companyIds.length
        ? supabaseService
            .from("opportunities")
            .select("company_id,assigned_to_user_id")
            .eq("workspace_id", scope.workspaceId)
            .eq("status", "open")
            .eq("opportunity_type", "revenue")
            .in("company_id", companyIds)
            .or(`owner_id.eq.${scope.userId},visibility.eq.team`)
            .limit(3000)
        : Promise.resolve({ data: [] as any[], error: null }),
      supabaseAdmin
        .from("outreach_messages")
        .select("prospect_id")
        .eq("workspace_id", scope.workspaceId)
        .limit(5000),
      supabaseAdmin
        .from("outreach_enrolments")
        .select("prospect_id")
        .eq("workspace_id", scope.workspaceId)
        .limit(5000),
    ]);
    const { data: opportunities, error: opportunitiesError } = opportunitiesResult;
    if (opportunitiesError) throw opportunitiesError;
    if (messagesResult.error) throw messagesResult.error;
    if (enrolmentsResult.error) throw enrolmentsResult.error;

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

    const prospectIdsWithMessages = new Set(
      (messagesResult.data || []).map((message: any) => message.prospect_id)
    );
    const prospectIdsWithEnrolments = new Set(
      (enrolmentsResult.data || []).map((enrolment: any) => enrolment.prospect_id)
    );
    const researchByProspect = new Map(
      (candidateResearch || []).map((row: any) => [row.id, row.research])
    );
    const prospectRecords = (prospects || [])
      .map((prospect: any) => {
        const assignable = isUntouchedOutreachAssignment(
          { ...prospect, research: researchByProspect.get(prospect.id) },
          {
            hasMessage: prospectIdsWithMessages.has(prospect.id),
            hasEnrolment: prospectIdsWithEnrolments.has(prospect.id),
          }
        );
        return {
          id: prospect.id,
          name: prospectName(prospect),
          email: prospect.email,
          jobTitle: prospect.job_title || null,
          companyName: prospect.company_name,
          priority: prospect.priority,
          priorityScore: prospect.priority_score,
          status: prospect.status,
          assignedToUserId: prospect.assigned_to_user_id || null,
          source: prospectSource(prospect),
          updatedAt: prospect.updated_at,
          assignable,
          blockedReason: assignable
            ? null
            : prospect.status === "suppressed"
              ? "Removed from outreach"
              : "Activity already exists. Review this person in Outreach before changing ownership.",
        };
      })
      .sort(
        (a: any, b: any) =>
          Number(b.assignable) - Number(a.assignable) ||
          Number(!b.assignedToUserId) - Number(!a.assignedToUserId) ||
          b.priorityScore - a.priorityScore ||
          a.companyName.localeCompare(b.companyName)
      );

    const records = (companies || [])
      .map((company: any) => ({
        id: company.id,
        name: company.name,
        sector: company.sector || null,
        stage: company.stage || null,
        updatedAt: company.updated_at,
        confidential: company.is_confidential === true,
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

    const activeProspects = prospectRecords.filter(
      (prospect: any) => prospect.status !== "suppressed"
    );
    const activeGrants = grants.filter((grant) => grant.status === "active");
    const team = (members || []).map((member: any) => ({
      userId: member.user_id,
      role: member.role,
      name:
        (profileById.get(member.user_id) as any)?.display_name ||
        (member.user_id === scope.userId ? "Lee" : "Team member"),
      workload: {
        prospects: activeProspects.filter(
          (prospect: any) => prospect.assignedToUserId === member.user_id
        ).length,
        clients: activeGrants.filter(
          (grant) => grant.assigned_to_user_id === member.user_id
        ).length,
        opportunities: (opportunities || []).filter(
          (opportunity: any) =>
            opportunity.assigned_to_user_id === member.user_id
        ).length,
      },
    }));

    return NextResponse.json(
      {
        records,
        prospects: prospectRecords,
        summary: {
          total: records.length,
          shared: records.filter((record: any) => record.shared).length,
          confidential: records.filter((record: any) => record.confidential).length,
          protected: records.filter((record: any) => record.blockedReason).length,
          outreachTotal: activeProspects.length,
          outreachAssignable: activeProspects.filter(
            (prospect: any) => prospect.assignable
          ).length,
          outreachInProgress: activeProspects.filter(
            (prospect: any) => !prospect.assignable
          ).length,
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
    const hasConfidentialityChange = Object.prototype.hasOwnProperty.call(
      body,
      "confidential"
    );
    const confidentialityChange =
      typeof body.confidential === "boolean" ? body.confidential : null;
    const shared = body.shared === true;
    const assignedToUserId =
      typeof body.assignedToUserId === "string"
        ? body.assignedToUserId.trim()
        : "";
    if (!UUID.test(companyId)) {
      return NextResponse.json(
        { error: "Choose a client record" },
        { status: 400 }
      );
    }
    if (hasConfidentialityChange && confidentialityChange === null) {
      return NextResponse.json(
        { error: "Choose whether this client is confidential" },
        { status: 400 }
      );
    }
    if (confidentialityChange === null && shared && !UUID.test(assignedToUserId)) {
      return NextResponse.json(
        { error: "Choose the salesperson responsible for this client" },
        { status: 400 }
      );
    }

    if (confidentialityChange === null && shared) {
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
      .select("id,name,stage,sector,profile,is_confidential,workspace_id,owner_id")
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

    if (confidentialityChange !== null) {
      const { data: saved, error: saveError } = await supabaseService.rpc(
        "set_company_confidentiality_service",
        {
          p_actor_user_id: scope.userId,
          p_company_id: companyId,
          p_confidential: confidentialityChange,
        }
      );
      if (saveError) throw saveError;
      if (
        !saved ||
        saved.companyId !== companyId ||
        saved.confidential !== confidentialityChange ||
        (confidentialityChange && saved.shared !== false)
      ) {
        throw new Error("The database did not confirm the privacy lock");
      }

      return NextResponse.json(
        {
          companyId,
          confidential: saved.confidential === true,
          shared: saved.shared === true,
          opportunitiesUpdated: saved.opportunitiesUpdated || 0,
          updatedAt: saved.updatedAt,
        },
        { headers: { "Cache-Control": "private, no-store" } }
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
