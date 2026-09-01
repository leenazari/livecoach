import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import {
  isInHouseRelationship,
  isNonCommercialRelationship,
} from "@/lib/relationship-stages";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import { requireRequestScope } from "@/lib/request-scope";
import { loadSafeSharedCompanies } from "@/lib/team-client-sharing";
import { loadVisibleOpportunities } from "@/lib/opportunity-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Supabase documents force-no-store/revalidate=0 as the explicit defence for
// Next.js 13/14 returning table data from before a recent change. Keep both on
// this high-value aggregate read in addition to the shared database fetch
// guard: client stages must never revert visually after a confirmed save.
export const fetchCache = "force-no-store";
export const revalidate = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

const validDateMs = (value: unknown): number | null => {
  if (typeof value !== "string" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const firstText = (value: unknown): string =>
  Array.isArray(value)
    ? String(value.find((item) => typeof item === "string" && item.trim()) || "").trim()
    : "";

// GET /api/crm/clients/portfolio
//
// A deterministic, model-free portfolio read. It joins the compact facts the
// client dashboard needs instead of asking Brain to reread histories, so it is
// fast, current and costs no AI tokens.
export async function GET() {
  try {
    const scope = requireRequestScope();
    const canManageAssignments =
      scope.role === "owner" || scope.role === "manager";
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const accountRecords = (query: any) => {
      const inWorkspace = query.eq("workspace_id", scope.workspaceId);
      return scope.role === "owner"
        ? inWorkspace
        : inWorkspace.eq("owner_id", scope.userId);
    };
    let clientSharesQuery: any = supabaseAdmin
      .from("team_client_shares")
      .select("company_id,status,assigned_to_user_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("status", "active")
      .limit(1500);
    if (scope.role !== "owner")
      clientSharesQuery = clientSharesQuery.eq(
        "assigned_to_user_id",
        scope.userId
      );
    let membersQuery = supabaseService
      .from("workspace_members")
      .select("user_id,role")
      .eq("workspace_id", scope.workspaceId)
      .eq("status", "active")
      .order("created_at");
    if (!canManageAssignments) {
      membersQuery = membersQuery.eq("user_id", scope.userId);
    }
    const [
      { data: ownedCompanies, error: companiesError },
      { data: contacts, error: contactsError },
      opportunities,
      { data: tasks, error: tasksError },
      { data: calls, error: callsError },
      { data: upcoming, error: upcomingError },
      { data: clientShares, error: clientSharesError },
      { data: members, error: membersError },
    ] = await Promise.all([
      accountRecords(
        supabaseAdmin
        .from("companies")
        .select("id,name,domain,website,sector,stage,profile,attributes,commercial_memory,created_at,updated_at")
      )
        .order("updated_at", { ascending: false })
        .limit(1000),
      accountRecords(
        supabaseAdmin
        .from("contacts")
        .select("id,company_id,name,role,email,attributes,created_at")
      )
        .not("company_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(3000),
      loadVisibleOpportunities(scope, {
        select:
          "id,company_id,title,value,status,opportunity_type,pipeline_stage,probability,next_action,next_action_due_at,assigned_to_user_id,updated_at,workspace_id,owner_id,visibility",
        status: "open",
        opportunityType: "revenue",
        orderBy: "updated_at",
        ascending: false,
        limit: 1000,
      }),
      accountRecords(
        supabaseAdmin
        .from("tasks")
        .select("id,company_id,text,kind,due_at,created_at")
      )
        .eq("status", "open")
        .not("company_id", "is", null)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(3000),
      accountRecords(
        supabaseAdmin
        .from("interview_summaries")
        .select("id,company_id,candidate,created_at")
      )
        .not("company_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(3000),
      accountRecords(
        supabaseAdmin
        .from("upcoming_calls")
        .select("company_id,title,scheduled_at")
      )
        .not("company_id", "is", null)
        .is("completed_at", null)
        .gte("scheduled_at", nowIso)
        .order("scheduled_at", { ascending: true })
        .limit(1000),
      clientSharesQuery,
      membersQuery,
    ]);

    const firstError = [
      companiesError,
      contactsError,
      tasksError,
      callsError,
      upcomingError,
      clientSharesError,
      membersError,
    ].find(Boolean);
    if (firstError) throw firstError;

    const sharedIds = (clientShares || []).map((share: any) => share.company_id);
    const assignedOpportunityCompanyIds = (opportunities || [])
      .filter((opportunity: any) => opportunity.owner_id !== scope.userId)
      .map((opportunity: any) => opportunity.company_id)
      .filter(Boolean);
    const ownedIds = new Set((ownedCompanies || []).map((company: any) => company.id));
    const safeSharedCompanies = await loadSafeSharedCompanies(
      [...new Set([...sharedIds, ...assignedOpportunityCompanyIds])].filter(
        (id: string) => !ownedIds.has(id)
      ),
      scope.workspaceId
    );
    const companies = [...(ownedCompanies || []), ...safeSharedCompanies];
    const activeShareIds = new Set(sharedIds);
    const shareByCompany = new Map(
      (clientShares || []).map((share: any) => [share.company_id, share])
    );

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
        (member.user_id === scope.userId ? "Me" : "Team member"),
    }));

    const contactsByCompany = new Map<string, any[]>();
    for (const contact of contacts || []) {
      if (!contact.company_id) continue;
      const list = contactsByCompany.get(contact.company_id) || [];
      list.push(contact);
      contactsByCompany.set(contact.company_id, list);
    }

    const opportunityByCompany = new Map<string, any>();
    for (const opportunity of opportunities || []) {
      if (opportunity.company_id && !opportunityByCompany.has(opportunity.company_id)) {
        opportunityByCompany.set(opportunity.company_id, opportunity);
      }
    }

    const tasksByCompany = new Map<string, any[]>();
    for (const task of tasks || []) {
      if (!task.company_id) continue;
      const list = tasksByCompany.get(task.company_id) || [];
      list.push(task);
      tasksByCompany.set(task.company_id, list);
    }

    const lastCallByCompany = new Map<
      string,
      { id: string; at: string; atMs: number; title: string | null }
    >();
    for (const call of calls || []) {
      if (!call.company_id || lastCallByCompany.has(call.company_id)) continue;
      const ms = validDateMs(call.created_at);
      if (ms != null) {
        lastCallByCompany.set(call.company_id, {
          id: call.id,
          at: call.created_at,
          atMs: ms,
          title: call.candidate || null,
        });
      }
    }

    const nextMeetingByCompany = new Map<string, any>();
    for (const meeting of upcoming || []) {
      if (!isPrepEligibleCalendarEvent(meeting)) continue;
      if (meeting.company_id && !nextMeetingByCompany.has(meeting.company_id)) {
        nextMeetingByCompany.set(meeting.company_id, meeting);
      }
    }

    const clients = (companies || [])
      .filter(
        (company: any) =>
          company.profile?.internal !== true &&
          !String(company.sector || "").toLowerCase().startsWith("internal")
      )
      .map((company: any) => {
      const companyContacts = contactsByCompany.get(company.id) || [];
      const primaryContact =
        companyContacts.find((contact: any) => contact.email) || companyContacts[0] || null;
      const opportunity = opportunityByCompany.get(company.id) || null;
      const openTasks = tasksByCompany.get(company.id) || [];
      const nextActionTask =
        openTasks.find((task: any) => task.kind !== "counterparty_commitment") || openTasks[0] || null;
      const nextActionText = String(opportunity?.next_action || nextActionTask?.text || "").trim();
      const nextActionDueAt = opportunity?.next_action_due_at || nextActionTask?.due_at || null;
      const nextActionDueMs = validDateMs(nextActionDueAt);
      const overdue = nextActionDueMs != null && nextActionDueMs < nowMs;
      const nextMeeting = nextMeetingByCompany.get(company.id) || null;

      const memory =
        company.commercial_memory && typeof company.commercial_memory === "object"
          ? company.commercial_memory
          : {};
      const profile = company.profile && typeof company.profile === "object" ? company.profile : {};
      const triage =
        profile.triage && typeof profile.triage === "object" ? profile.triage : {};
      const relationshipType = String(triage.classification || "").trim() || null;
      const archived =
        profile.archived === true ||
        String(company.stage || "").trim().toLowerCase() === "dormant";
      const emailMs = validDateMs(profile.email_last_message_at);
      const latestCall = lastCallByCompany.get(company.id) || null;
      const callMs = latestCall?.atMs || null;
      const outreachMs = Math.max(
        validDateMs(memory.outreach?.lastReplyAt) || 0,
        validDateMs(memory.outreach?.lastContactedAt) || 0
      ) || null;
      const activityMs = validDateMs(memory.latestActivity?.at);
      const lastTouchMs =
        Math.max(emailMs || 0, callMs || 0, outreachMs || 0, activityMs || 0) || null;
      const lastTouchAt = lastTouchMs ? new Date(lastTouchMs).toISOString() : null;
      const daysQuiet = lastTouchMs
        ? Math.max(0, Math.floor((nowMs - lastTouchMs) / DAY_MS))
        : null;

      const stageKey = String(company.stage || "").toLowerCase();
      const isInHouse = isInHouseRelationship(company.stage);
      const isNonCommercial = isNonCommercialRelationship(company.stage);
      const reasons: string[] = [];
      let health: "red" | "amber" | "green" | "grey" = "grey";
      if (overdue) reasons.push("Overdue next action");
      if (opportunity && !nextActionText) reasons.push("Opportunity has no next action");
      if (opportunity && !nextMeeting) reasons.push("No next meeting booked");
      if (!primaryContact) reasons.push("No contact recorded");
      if (!company.stage) reasons.push("Relationship stage missing");
      if (!isNonCommercial && daysQuiet != null && daysQuiet >= 21) {
        reasons.push(`Quiet for ${daysQuiet} days`);
      }
      const activityRisk = firstText(memory.latestActivity?.risks);
      const pendingActivityPlan =
        memory.latestActivity?.status === "pending" &&
        String(memory.latestActivity?.nextAction || "").trim();
      if (pendingActivityPlan) reasons.unshift("New client update needs approval");
      if (activityRisk) reasons.unshift(`New risk: ${activityRisk}`);

      const establishedRelationship = [
        "discovery",
        "qualified",
        "proposal",
        "negotiation",
        "partner",
        "customer",
        "demo",
      ].includes(stageKey);
      const hasCommercialWork = !!opportunity || openTasks.length > 0;

      if (overdue || (opportunity && daysQuiet != null && daysQuiet >= 21)) {
        health = "red";
      } else if (
        activityRisk ||
        pendingActivityPlan ||
        (hasCommercialWork && (!nextMeeting || !nextActionText)) ||
        (hasCommercialWork && daysQuiet != null && daysQuiet >= 7) ||
        (establishedRelationship && daysQuiet != null && daysQuiet >= 14)
      ) {
        health = "amber";
        if (daysQuiet != null && daysQuiet >= 7 && daysQuiet < 21) {
          reasons.unshift(`Quiet for ${daysQuiet} days`);
        }
      } else if (isInHouse) {
        health = "green";
        reasons.unshift("Internal contact");
      } else if (nextMeeting || (daysQuiet != null && daysQuiet < 7 && reasons.length === 0)) {
        health = "green";
        reasons.push(nextMeeting ? "Next meeting booked" : "Recently active");
      } else {
        if (!reasons.length) reasons.push("Not enough activity data yet");
      }

      const lastCall = memory.lastCall && typeof memory.lastCall === "object" ? memory.lastCall : {};
      const buyingSignal =
        firstText(memory.latestActivity?.buyingSignals) ||
        firstText(lastCall.buyingSignals) ||
        firstText(lastCall.commercialOpportunities);
      const stage = String(company.stage || opportunity?.pipeline_stage || "").trim();
      let category = "Relationship";
      if (archived) category = "Archived";
      else if (relationshipType === "prospect") category = "Prospect";
      else if (relationshipType === "partner") category = "Partner";
      else if (relationshipType === "customer") category = "Customer";
      else if (relationshipType === "product_trial") category = "Product Trial";
      else if (relationshipType === "in_house" || isInHouse) category = "In House";
      else if (isNonCommercial) category = "Product Trial";
      else if (opportunity) category = "Opportunity";
      else if (String(company.stage || "").toLowerCase() === "customer")
        category = "Customer";

      return {
        id: company.id,
        name: company.name,
        shared: activeShareIds.has(company.id),
        accessMode: ownedIds.has(company.id) ? "owner" : "shared_sales",
        assignedToUserId:
          (shareByCompany.get(company.id) as any)?.assigned_to_user_id ||
          (ownedIds.has(company.id) ? scope.userId : null),
        sector: company.sector || null,
        relationshipStage: company.stage || null,
        relationshipType,
        triageReviewedAt:
          typeof triage.reviewedAt === "string" ? triage.reviewedAt : null,
        archived,
        category,
        createdAt:
          typeof company.created_at === "string" ? company.created_at : null,
        primaryContact: primaryContact
          ? {
              name: primaryContact.name,
              role: primaryContact.role || null,
              email: primaryContact.email || null,
            }
          : null,
        health,
        healthReason: reasons[0],
        healthReasons: reasons.slice(0, 3),
        lastTouchAt,
        daysQuiet,
        lastCallId: latestCall?.id || null,
        lastCallAt: latestCall?.at || null,
        lastCallTitle: latestCall?.title || null,
        nextMeetingAt: nextMeeting?.scheduled_at || null,
        nextMeetingTitle: nextMeeting?.title || null,
        nextAction: nextActionText || null,
        nextActionDueAt,
        openTaskCount: openTasks.length,
        buyingSignal: buyingSignal || null,
        opportunity: opportunity
          ? {
              id: opportunity.id,
              title: opportunity.title,
              stage: opportunity.pipeline_stage || stage || "discovery",
              probability: Math.max(0, Math.min(100, Number(opportunity.probability) || 0)),
              value:
                opportunity.value != null && Number(opportunity.value) > 0
                  ? Number(opportunity.value)
                  : null,
            }
          : null,
      };
    });

    const rank = { red: 0, amber: 1, green: 2, grey: 3 } as const;
    clients.sort((a: any, b: any) => {
      const healthDiff = rank[a.health as keyof typeof rank] - rank[b.health as keyof typeof rank];
      if (healthDiff) return healthDiff;
      const aDue = validDateMs(a.nextActionDueAt) ?? Infinity;
      const bDue = validDateMs(b.nextActionDueAt) ?? Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json(
      {
        clients,
        totals: clients.reduce(
          (acc: Record<string, number>, client: any) => {
            if (client.archived) {
              acc.archived += 1;
            } else {
              acc.all += 1;
              acc[client.health] += 1;
              if (client.opportunity) acc.opportunities += 1;
            }
            return acc;
          },
          { all: 0, red: 0, amber: 0, green: 0, grey: 0, opportunities: 0, archived: 0 }
        ),
        generatedAt: new Date().toISOString(),
        team,
        currentUser: scope.userId,
        canManageAssignments,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to load client portfolio" },
      { status: 500 }
    );
  }
}
