import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { defaultOutlookQuestions, WIN_OUTLOOKS } from "@/lib/opportunity-fields";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import { getAppConfigRows, setAppConfigValue } from "@/lib/app-config";
import { requireRequestScope, requireWorkspaceManager } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { loadVisibleOpportunities } from "@/lib/opportunity-access";
import {
  activeSharedClientIds,
  loadSafeSharedCompanies,
} from "@/lib/team-client-sharing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGES = [
  { key: "new", label: "New", probability: 10 },
  { key: "discovery", label: "Discovery", probability: 20 },
  { key: "qualified", label: "Qualified", probability: 40 },
  { key: "proposal", label: "Proposal", probability: 60 },
  { key: "negotiation", label: "Negotiation", probability: 75 },
  { key: "verbal", label: "Verbal", probability: 90 },
];

const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const account = requireRequestScope();
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();

    const accountRecords = (query: any) => {
      const inWorkspace = query.eq("workspace_id", account.workspaceId);
      return account.role === "owner"
        ? inWorkspace
        : inWorkspace.eq("owner_id", account.userId);
    };
    let companyQuery = supabaseAdmin
      .from("companies")
      .select("id,name,stage,profile,owner_id")
      .eq("workspace_id", account.workspaceId);
    if (account.role !== "owner")
      companyQuery = companyQuery.eq("owner_id", account.userId);
    let prospectCountQuery: any = supabaseAdmin
      .from("outreach_prospects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", account.workspaceId);
    let prospectRowsQuery: any = supabaseAdmin
      .from("outreach_prospects")
      .select("id,crm_company_id,company_name")
      .eq("workspace_id", account.workspaceId)
      .limit(5000);
    if (account.role !== "owner") {
      prospectCountQuery = prospectCountQuery.eq(
        "assigned_to_user_id",
        account.userId
      );
      prospectRowsQuery = prospectRowsQuery.eq(
        "assigned_to_user_id",
        account.userId
      );
    }
    const [
      { data: config },
      { data: ownedCompanies },
      opportunities,
      { data: upcoming },
      { data: calls },
      { data: tasks },
      { count: prospectCount },
      { data: outreachCompanyRows },
      sharedClientIds,
    ] = await Promise.all([
      getAppConfigRows(["revenue_target_gbp"]).then((data) => ({ data })),
      companyQuery,
      loadVisibleOpportunities(account, {
        orderBy: "updated_at",
        ascending: false,
        limit: 500,
      }),
      accountRecords(
        supabaseAdmin
          .from("upcoming_calls")
          .select("company_id,title,scheduled_at")
      )
        .is("completed_at", null)
        .gte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(500),
      accountRecords(
        supabaseAdmin
          .from("interview_summaries")
          .select("company_id,created_at")
      )
        .not("company_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(2000),
      accountRecords(
        supabaseAdmin.from("tasks").select("company_id,text,due_at,kind")
      )
        .eq("status", "open")
        .not("company_id", "is", null)
        .limit(2000),
      prospectCountQuery,
      prospectRowsQuery,
      activeSharedClientIds(
        account.workspaceId,
        account.role === "owner" ? undefined : account.userId
      ),
    ]);

    const visibleProspectIds = (outreachCompanyRows || []).map((row: any) => row.id);
    const visibleOpportunityIds = (opportunities || []).map((row: any) => row.id);
    const emptyRows = Promise.resolve({ data: [] as any[], error: null });
    let usageQuery: any = supabaseAdmin
      .from("usage_log")
      .select("cost_gbp,created_at")
      .eq("workspace_id", account.workspaceId)
      .eq("kind", "opportunity_outlook_assessment")
      .gte("created_at", new Date(Date.now() - 7 * DAY).toISOString())
      .limit(1000);
    if (account.role !== "owner")
      usageQuery = usageQuery.eq("owner_id", account.userId);
    const [
      { data: sentMessages },
      { data: outreachEvents },
      { data: signalReceipts },
      { data: recentSignalReceipts },
      { data: signalUsage },
    ] = await Promise.all([
      visibleProspectIds.length
        ? supabaseAdmin
            .from("outreach_messages")
            .select("prospect_id,message_tags,step_number,variant")
            .eq("workspace_id", account.workspaceId)
            .eq("status", "sent")
            .in("prospect_id", visibleProspectIds)
            .limit(5000)
        : emptyRows,
      visibleProspectIds.length
        ? supabaseAdmin
            .from("outreach_events")
            .select("prospect_id,kind,metadata,created_at")
            .eq("workspace_id", account.workspaceId)
            .in("prospect_id", visibleProspectIds)
            .in("kind", [
              "reply",
              "positive_reply",
              "objection",
              "later",
              "referral",
              "meeting_booked",
            ])
            .limit(5000)
        : emptyRows,
      visibleOpportunityIds.length
        ? supabaseAdmin
            .from("opportunity_signal_receipts")
            .select("opportunity_id,status")
            .eq("workspace_id", account.workspaceId)
            .in("opportunity_id", visibleOpportunityIds)
            .in("status", ["queued", "processing", "failed"])
            .limit(1000)
        : emptyRows,
      visibleOpportunityIds.length
        ? supabaseAdmin
            .from("opportunity_signal_receipts")
            .select("id,opportunity_id,company_id,source_record_type,source_channel,status,result,evidence,occurred_at,attempts,error,created_at,updated_at")
            .eq("workspace_id", account.workspaceId)
            .in("opportunity_id", visibleOpportunityIds)
            .gte("created_at", new Date(Date.now() - 7 * DAY).toISOString())
            .order("created_at", { ascending: false })
            .limit(200)
        : emptyRows,
      usageQuery,
    ]);

    const ownedCompanyIds = new Set(
      (ownedCompanies || []).map((company: any) => company.id)
    );
    const visibleOpportunityCompanyIds = (opportunities || [])
      .filter((opportunity: any) => opportunity.owner_id !== account.userId)
      .map((opportunity: any) => opportunity.company_id)
      .filter(Boolean);
    const sharedCompanies = await loadSafeSharedCompanies(
      [...new Set([...sharedClientIds, ...visibleOpportunityCompanyIds])].filter(
        (id) => !ownedCompanyIds.has(id)
      ),
      account.workspaceId
    );
    const companies = [...(ownedCompanies || []), ...sharedCompanies];

    const target = Math.max(1, Number((config || []).find((row: any) => row.key === "revenue_target_gbp")?.value) || 2_000_000);
    const nameByCompany = new Map<string, string>();
    const outreachNameByCompany = new Map<string, string>();
    const stageByCompany = new Map<string, string>();
    const lastTouchByCompany = new Map<string, number>();
    const nextMeetingByCompany = new Map<string, string>();
    const tasksByCompany = new Map<string, any[]>();
    const signalsByOpportunity = new Map<string, { pending: number; failed: number }>();

    for (const company of companies || []) {
      nameByCompany.set(company.id, company.name);
      if (company.stage) stageByCompany.set(company.id, company.stage);
      const emailAt = (company.profile as any)?.email_last_message_at;
      if (emailAt) lastTouchByCompany.set(company.id, new Date(emailAt).getTime());
    }
    for (const prospect of outreachCompanyRows || []) {
      if (prospect.crm_company_id && prospect.company_name && !outreachNameByCompany.has(prospect.crm_company_id))
        outreachNameByCompany.set(prospect.crm_company_id, prospect.company_name);
    }
    for (const call of calls || []) {
      const at = new Date(call.created_at as string).getTime();
      if (call.company_id && at > (lastTouchByCompany.get(call.company_id) || 0)) lastTouchByCompany.set(call.company_id, at);
    }
    for (const meeting of upcoming || []) {
      if (!isPrepEligibleCalendarEvent(meeting)) continue;
      if (meeting.company_id && !nextMeetingByCompany.has(meeting.company_id)) nextMeetingByCompany.set(meeting.company_id, meeting.scheduled_at);
    }
    for (const task of tasks || []) {
      if (!task.company_id) continue;
      tasksByCompany.set(task.company_id, [...(tasksByCompany.get(task.company_id) || []), task]);
    }
    for (const receipt of signalReceipts || []) {
      if (!receipt.opportunity_id) continue;
      const current = signalsByOpportunity.get(receipt.opportunity_id) || { pending: 0, failed: 0 };
      if (receipt.status === "failed") current.failed += 1;
      else current.pending += 1;
      signalsByOpportunity.set(receipt.opportunity_id, current);
    }

    const openAll = (opportunities || []).filter((op: any) => op.status === "open");
    const open = openAll.filter((op: any) => (op.opportunity_type || "revenue") === "revenue");
    const excluded = openAll.filter((op: any) => (op.opportunity_type || "revenue") !== "revenue");
    const wonYtd = (opportunities || []).filter((op: any) => op.status === "won" && (op.opportunity_type || "revenue") === "revenue" && new Date(op.won_at || op.updated_at || op.created_at).toISOString() >= yearStart);
    const wonValue = wonYtd.reduce((sum: number, op: any) => sum + (Number(op.value) || 0), 0);
    const rawPipeline = open.reduce((sum: number, op: any) => sum + (Number(op.value) || 0), 0);
    const weightedPipeline = open.reduce((sum: number, op: any) => sum + (Number(op.value) || 0) * (Math.max(0, Math.min(100, Number(op.probability) || 0)) / 100), 0);
    const commit = open.filter((op: any) => op.forecast_category === "commit").reduce((sum: number, op: any) => sum + (Number(op.value) || 0), 0);
    const bestCase = open.filter((op: any) => ["commit", "best_case"].includes(op.forecast_category)).reduce((sum: number, op: any) => sum + (Number(op.value) || 0), 0);
    const gap = Math.max(0, target - wonValue);
    const monthsRemaining = Math.max(1, 12 - now.getUTCMonth());

    const rows = open.map((op: any) => {
      const companyId = op.company_id as string;
      const value = Number(op.value) || 0;
      const probability = Math.max(0, Math.min(100, Number(op.probability) || 0));
      const nextMeetingAt = nextMeetingByCompany.get(companyId) || null;
      const storedActivity = op.last_meaningful_activity_at
        ? new Date(op.last_meaningful_activity_at).getTime()
        : 0;
      const lastTouch = Math.max(lastTouchByCompany.get(companyId) || 0, storedActivity || 0) || null;
      const daysQuiet = lastTouch ? Math.max(0, Math.floor((Date.now() - lastTouch) / DAY)) : null;
      const risks: { code: string; label: string; severity: "high" | "medium" }[] = [];
      if (!value) risks.push({ code: "missing_value", label: "Deal value missing", severity: "high" });
      if (!op.expected_close_at) risks.push({ code: "missing_close", label: "Expected close date missing", severity: "medium" });
      if (op.expected_close_at && new Date(`${op.expected_close_at}T23:59:59`).getTime() < Date.now()) risks.push({ code: "close_overdue", label: "Expected close date passed", severity: "high" });
      if (!nextMeetingAt) risks.push({ code: "no_meeting", label: "No next meeting", severity: probability >= 60 ? "high" : "medium" });
      if (daysQuiet != null && daysQuiet >= 14) risks.push({ code: "quiet", label: `Quiet for ${daysQuiet} days`, severity: "high" });
      if (op.forecast_category === "commit" && probability < 70) risks.push({ code: "weak_commit", label: "Commit probability is below 70%", severity: "high" });
      if (op.win_outlook === "at_risk")
        risks.push({ code: "outlook_at_risk", label: "Win outlook is at risk", severity: "high" });
      if (op.win_outlook === "not_assessed")
        risks.push({ code: "outlook_unassessed", label: "Win outlook needs evidence", severity: "medium" });
      if (!op.next_action) risks.push({ code: "missing_next_action", label: "Primary next action not confirmed", severity: "medium" });
      if (op.next_action_due_at && new Date(op.next_action_due_at).getTime() < Date.now()) risks.push({ code: "next_action_overdue", label: "Primary next action is overdue", severity: "high" });
      const companyTasks = tasksByCompany.get(companyId) || [];
      const signalState = signalsByOpportunity.get(op.id) || { pending: 0, failed: 0 };
      const overdue = companyTasks.filter((task: any) => task.due_at && new Date(task.due_at).getTime() < Date.now());
      if (overdue.length) risks.push({ code: "overdue_actions", label: `${overdue.length} overdue action${overdue.length === 1 ? "" : "s"}`, severity: "high" });

      let nextAction = String(op.next_action || "").trim();
      if (!nextAction) nextAction = companyTasks.find((task: any) => task.due_at)?.text || companyTasks[0]?.text || "";
      if (!nextAction && !value) nextAction = "Set a realistic opportunity value";
      else if (!nextAction && !nextMeetingAt) nextAction = "Secure the next decision-focused meeting";
      else if (!nextAction && op.pipeline_stage === "discovery") nextAction = "Confirm buyer need, urgency and decision process";
      else if (!nextAction) nextAction = "Agree the next mutual commitment";

      const nextActionDueMs = op.next_action_due_at ? new Date(op.next_action_due_at).getTime() : null;
      const nextMeetingMs = nextMeetingAt ? new Date(nextMeetingAt).getTime() : null;
      const nextActionOverdue = !!nextActionDueMs && nextActionDueMs < Date.now();
      const meetingSoon = !!nextMeetingMs && nextMeetingMs <= Date.now() + 3 * DAY;
      const stalled = daysQuiet != null && daysQuiet >= 14;
      const priorityReasons = [
        nextActionOverdue ? "Overdue action" : "",
        meetingSoon ? "Meeting in the next 3 days" : "",
        op.win_outlook === "at_risk" ? "At-risk outlook" : "",
        stalled ? `Stalled for ${daysQuiet} days` : "",
        op.next_action ? "Clear next action" : "",
        signalState.failed ? "New evidence needs retry" : "",
        signalState.pending ? "New evidence is being assessed" : "",
      ].filter(Boolean);
      const riskWeight = risks.reduce((sum, risk) => sum + (risk.severity === "high" ? 30 : 12), 0);
      const actionScore =
        (nextActionOverdue ? 1000 : 0) +
        (meetingSoon ? 700 : 0) +
        (op.win_outlook === "at_risk" ? 600 : 0) +
        (stalled ? 500 : 0) +
        (op.next_action ? 120 : 0) +
        (signalState.failed ? 450 : 0) +
        (signalState.pending ? 180 : 0) +
        riskWeight +
        Math.min(50, value / 20_000);
      return {
        ...op,
        value,
        probability,
        weightedValue: value * probability / 100,
        company: nameByCompany.get(companyId) || outreachNameByCompany.get(companyId) || "Private client",
        relationshipStage: stageByCompany.get(companyId) || null,
        nextMeetingAt,
        lastMeaningfulActivityAt: lastTouch ? new Date(lastTouch).toISOString() : null,
        daysQuiet,
        risks,
        nextAction,
        nextActionIsSaved: !!op.next_action,
        outlookQuestions:
          Array.isArray(op.win_outlook_questions) && op.win_outlook_questions.length
            ? op.win_outlook_questions
            : defaultOutlookQuestions(op),
        priorityReasons,
        pendingSignalCount: signalState.pending,
        failedSignalCount: signalState.failed,
        actionScore,
      };
    }).sort((a: any, b: any) => b.actionScore - a.actionScore);

    const excludedRows = excluded.map((op: any) => ({
      ...op,
      value: Number(op.value) || 0,
      company: nameByCompany.get(op.company_id) || outreachNameByCompany.get(op.company_id) || "Private client",
    })).sort((a: any, b: any) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));

    const stages = STAGES.map((stage) => {
      const members = rows.filter((row: any) => row.pipeline_stage === stage.key);
      return {
        ...stage,
        count: members.length,
        value: members.reduce((sum: number, row: any) => sum + row.value, 0),
        weighted: members.reduce((sum: number, row: any) => sum + row.weightedValue, 0),
      };
    });
    const outlooks = WIN_OUTLOOKS.map((key) => {
      const members = rows.filter((row: any) => (row.win_outlook || "not_assessed") === key);
      return {
        key,
        count: members.length,
        value: members.reduce((sum: number, row: any) => sum + row.value, 0),
      };
    });

    const uniqueSent = new Set((sentMessages || []).map((row: any) => row.prospect_id).filter(Boolean));
    const replyKinds = new Set(["reply", "positive_reply", "objection", "later", "referral"]);
    const replied = new Set((outreachEvents || []).filter((event: any) => replyKinds.has(event.kind)).map((event: any) => event.prospect_id).filter(Boolean));
    const positive = new Set((outreachEvents || []).filter((event: any) => event.kind === "positive_reply").map((event: any) => event.prospect_id).filter(Boolean));
    const booked = new Set((outreachEvents || []).filter((event: any) => event.kind === "meeting_booked").map((event: any) => event.prospect_id).filter(Boolean));
    const outreachOpps = (opportunities || []).filter((op: any) => op.source === "outreach" && (op.opportunity_type || "revenue") === "revenue");
    const opportunityById = new Map((opportunities || []).map((op: any) => [op.id, op]));
    const signalCounts = {
      queued: 0,
      processing: 0,
      complete: 0,
      ignored: 0,
      protected: 0,
      failed: 0,
    };
    for (const receipt of recentSignalReceipts || []) {
      const status = String(receipt.status || "");
      if (status in signalCounts) signalCounts[status as keyof typeof signalCounts] += 1;
    }
    const assessedSignals = (recentSignalReceipts || []).filter((receipt: any) =>
      ["complete", "ignored"].includes(receipt.status)
      && typeof receipt.result?.material === "boolean"
    ).length;
    const evidenceSummary = (evidence: Record<string, unknown> | null) => {
      if (!evidence || typeof evidence !== "object") return "No evidence digest was stored.";
      const preferred = ["summary", "overview", "subject", "snippet", "note", "outcome"];
      for (const key of preferred) {
        const value = evidence[key];
        if (typeof value === "string" && value.trim()) return value.trim().slice(0, 420);
      }
      const first = Object.values(evidence).find((value) => typeof value === "string" && value.trim());
      return typeof first === "string" ? first.trim().slice(0, 420) : "A compact structured signal was stored.";
    };
    const recentAssessments = (recentSignalReceipts || []).slice(0, 12).map((receipt: any) => {
      const opportunity = opportunityById.get(receipt.opportunity_id) as any;
      return {
        id: receipt.id,
        company: nameByCompany.get(receipt.company_id) || "Unlinked company",
        opportunity: opportunity?.title || "No single open revenue opportunity",
        sourceRecordType: receipt.source_record_type,
        sourceChannel: receipt.source_channel,
        status: receipt.status,
        occurredAt: receipt.occurred_at,
        createdAt: receipt.created_at,
        attempts: Number(receipt.attempts) || 0,
        error: receipt.error || null,
        evidenceSummary: evidenceSummary(receipt.evidence),
        result: receipt.result || {},
      };
    });

    const { data: members, error: membersError } = await supabaseService
      .from("workspace_members")
      .select("user_id,role")
      .eq("workspace_id", account.workspaceId)
      .eq("status", "active")
      .order("created_at");
    if (membersError) throw membersError;
    const memberIds = (members || []).map((member: any) => member.user_id);
    const { data: profiles, error: profilesError } = memberIds.length
      ? await supabaseService
          .from("profiles")
          .select("user_id,display_name")
          .in("user_id", memberIds)
      : { data: [] as any[], error: null };
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));
    const team = (members || []).map((member: any) => ({
      userId: member.user_id,
      role: member.role,
      name: (profileById.get(member.user_id) as any)?.display_name || "Team member",
    }));

    return NextResponse.json({
      goal: { target, wonYtd: wonValue, gap, monthsRemaining, requiredPerMonth: gap / monthsRemaining },
      kpis: { rawPipeline, weightedPipeline, commit, bestCase, wonYtd: wonValue, coverage: gap ? rawPipeline / gap : 0 },
      stages,
      outlooks,
      opportunities: rows,
      excludedOpportunities: excludedRows,
      classification: {
        revenue: open.length,
        investment: excluded.filter((op: any) => op.opportunity_type === "investment").length,
        internal: excluded.filter((op: any) => op.opportunity_type === "internal").length,
        strategic: excluded.filter((op: any) => op.opportunity_type === "strategic").length,
      },
      priorities: rows.slice(0, 8),
      funnel: [
        { key: "prospects", label: "Prospects", value: prospectCount || 0 },
        { key: "contacted", label: "Contacted", value: uniqueSent.size },
        { key: "replied", label: "Replied", value: replied.size },
        { key: "positive", label: "Positive", value: positive.size },
        { key: "booked", label: "Meetings", value: booked.size },
        { key: "opportunities", label: "Opportunities", value: outreachOpps.length },
        { key: "won", label: "Won", value: outreachOpps.filter((op: any) => op.status === "won").length },
      ],
      signalHealth: {
        windowStart: new Date(Date.now() - 7 * DAY).toISOString(),
        auditTarget: 5,
        assessedSignals,
        costGbp: (signalUsage || []).reduce((sum: number, row: any) => sum + (Number(row.cost_gbp) || 0), 0),
        counts: signalCounts,
        recentAssessments,
      },
      stageDefinitions: STAGES,
      team,
      currentUser: account.userId,
      canManageAssignments: account.role === "owner" || account.role === "manager",
      generatedAt: new Date().toISOString(),
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load revenue pipeline" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    requireWorkspaceManager();
    const body = await req.json();
    const target = Math.round(Number(body.target));
    if (!Number.isFinite(target) || target < 1_000 || target > 1_000_000_000) {
      return NextResponse.json({ error: "Enter a revenue target between £1,000 and £1 billion" }, { status: 400 });
    }
    const data = await setAppConfigValue({
        key: "revenue_target_gbp",
        value: String(target),
        note: "Annual revenue target used by the revenue command centre",
        visibility: "team",
      });
    const confirmedTarget = Math.round(Number(data.value));
    if (confirmedTarget !== target)
      throw new Error("database did not confirm the revenue target");
    return NextResponse.json({ ok: true, target: confirmedTarget });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to save revenue target" }, { status: 500 });
  }
}
