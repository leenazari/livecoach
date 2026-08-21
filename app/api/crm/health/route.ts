import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  findDuplicateCompanies,
  findNearDuplicateTasks,
  healthOverall,
  healthTotals,
  type HealthCheck,
  type HealthReport,
  type HealthStatus,
} from "@/lib/crm-health";
import {
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  googleConnected,
  googleGrantedScopes,
} from "@/lib/google";
import { gmailAccessDiagnostic } from "@/lib/gmail";
import { getAppConfigValue } from "@/lib/app-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DAY = 24 * 60 * 60 * 1000;

const validDateMs = (value: unknown): number | null => {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const titleCase = (value: string) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const atRisk = (
  count: number,
  attention: Omit<HealthCheck, "status" | "count">,
  healthy: Omit<HealthCheck, "status" | "count" | "id" | "title" | "why">,
  severity: Exclude<HealthStatus, "healthy"> = "attention"
): HealthCheck =>
  count
    ? { ...attention, status: severity, count }
    : {
        id: attention.id,
        title: attention.title,
        why: attention.why,
        ...healthy,
        status: "healthy",
        count: 0,
      };

async function googleHealth() {
  try {
    const connection = await googleConnected();
    if (!connection.connected) {
      return {
        connected: false,
        email: null as string | null,
        read: false,
        send: false,
        issue: "disconnected",
      };
    }
    const [scopes, diagnostic] = await Promise.all([
      googleGrantedScopes(),
      gmailAccessDiagnostic(),
    ]);
    return {
      connected: true,
      email: connection.email,
      // The live Gmail request is definitive when tokeninfo omits a scope.
      read: scopes.has(GMAIL_READ_SCOPE) || diagnostic.status === "ok",
      send: scopes.has(GMAIL_SEND_SCOPE),
      issue: diagnostic.issue,
    };
  } catch {
    return {
      connected: false,
      email: null as string | null,
      read: false,
      send: false,
      issue: "google_error",
    };
  }
}

// A model-free, read-only CRM sweep. Every database read is bounded and runs in
// parallel. No transcript, email body, profile or research payload is loaded.
export async function GET() {
  try {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * DAY).toISOString();
    const eightDaysAgo = new Date(now - 8 * DAY).toISOString();
    const thirtyDaysAhead = new Date(now + 30 * DAY).toISOString();

    const [
      companiesRes,
      contactsRes,
      tasksRes,
      opportunitiesRes,
      upcomingRes,
      summariesRes,
      draftsRes,
      usageRes,
      precallEmailRes,
      google,
    ] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id,name,domain,website,stage,commercial_memory,updated_at")
        .limit(1500),
      supabaseAdmin
        .from("contacts")
        .select("id,company_id,email")
        .limit(4000),
      supabaseAdmin
        .from("tasks")
        .select("id,company_id,text,kind,due_at,status,created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(3000),
      supabaseAdmin
        .from("opportunities")
        .select("id,company_id,title,status,opportunity_type,pipeline_stage,next_action,next_action_due_at,next_action_owner,updated_at")
        .eq("status", "open")
        .eq("opportunity_type", "revenue")
        .limit(1200),
      supabaseAdmin
        .from("upcoming_calls")
        .select("id,company_id,title,scheduled_at,attendees,source,completed_at")
        .is("completed_at", null)
        .gte("scheduled_at", nowIso)
        .lte("scheduled_at", thirtyDaysAhead)
        .limit(1000),
      supabaseAdmin
        .from("interview_summaries")
        .select("id,company_id,created_at")
        .gte("created_at", thirtyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("follow_ups")
        .select("id,company_id,draft_subject,status,created_at")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("usage_log")
        .select("kind,cost_gbp,created_at")
        .gte("created_at", eightDaysAgo)
        .order("created_at", { ascending: false })
        .limit(5000),
      getAppConfigValue("precall_email_context_last_run").then((data) => ({
        data,
        error: null,
      })),
      googleHealth(),
    ]);

    for (const result of [
      companiesRes,
      contactsRes,
      tasksRes,
      opportunitiesRes,
      upcomingRes,
      summariesRes,
      draftsRes,
      usageRes,
      precallEmailRes,
    ]) {
      if (result.error) throw result.error;
    }

    const companies: any[] = companiesRes.data || [];
    const contacts: any[] = contactsRes.data || [];
    const tasks: any[] = tasksRes.data || [];
    const opportunities: any[] = opportunitiesRes.data || [];
    const upcoming: any[] = upcomingRes.data || [];
    const summaries: any[] = summariesRes.data || [];
    const drafts: any[] = draftsRes.data || [];
    const usage: any[] = usageRes.data || [];
    const companyIds = new Set(companies.map((company) => company.id));
    const companyName = new Map(
      companies.map((company) => [company.id, company.name || "Unnamed client"])
    );
    const checks: HealthCheck[] = [];

    checks.push({
      id: "calendar",
      title: "Google Calendar",
      status: google.connected ? "healthy" : "critical",
      count: google.connected ? 0 : 1,
      detail: google.connected
        ? `Connected${google.email ? ` as ${google.email}` : ""}. Refreshing checks the next 30 days.`
        : "Calendar is disconnected, so calls and cancellations cannot stay current.",
      why: "Upcoming calls, prep and booked demos all depend on this connection.",
      href: "/settings",
      action: google.connected
        ? {
            label: "Refresh calendar now",
            endpoint: "/api/crm/calendar-sync",
            method: "POST",
          }
        : undefined,
    });

    checks.push({
      id: "gmail-read",
      title: "Gmail context",
      status: google.read ? "healthy" : "critical",
      count: google.read ? 0 : 1,
      detail: google.read
        ? "Read access is working, so recent email context can inform client intent."
        : `Gmail read access is unavailable (${titleCase(google.issue)}).`,
      why: "Without read access, prep can miss the latest promises, objections and replies.",
      href: "/settings",
    });

    checks.push({
      id: "gmail-send",
      title: "Gmail sending",
      status: google.send ? "healthy" : "attention",
      count: google.send ? 0 : 1,
      detail: google.send
        ? "Send access is granted for approved outreach and daily brief emails."
        : "Gmail send permission is missing or could not be confirmed.",
      why: "Sending is separate from reading and is required for approved messages.",
      href: google.send ? "/crm/outreach?tab=safety" : "/settings",
    });

    let precallReport: any = null;
    try {
      precallReport = precallEmailRes.data?.value
        ? JSON.parse(String(precallEmailRes.data.value))
        : null;
    } catch {
      precallReport = null;
    }
    const precallUpdatedAt = validDateMs(precallEmailRes.data?.updated_at);
    const precallIsRecent = !!precallUpdatedAt && now - precallUpdatedAt < 6 * 60 * 60 * 1000;
    const precallFailures = Number(precallReport?.failed) || 0;
    checks.push({
      id: "precall-email-context",
      title: "Pre-call email automation",
      status: precallIsRecent && precallFailures === 0 ? "healthy" : "attention",
      count: precallFailures || (precallIsRecent ? 0 : 1),
      detail: precallIsRecent
        ? `${Number(precallReport?.checked) || 0} client${Number(precallReport?.checked) === 1 ? "" : "s"} checked in the latest run, ${Number(precallReport?.contextRefreshed) || 0} email context update${Number(precallReport?.contextRefreshed) === 1 ? "" : "s"}, ${precallFailures} failed.`
        : "The two-hour pre-call email check has not completed recently yet.",
      why: "Upcoming external calls need the newest email promises and objections before their intent is prepared.",
      href: "/crm/board?tab=clients",
    });

    const duplicateCompanies = findDuplicateCompanies(companies, contacts, 40);
    checks.push(
      atRisk(
        duplicateCompanies.length,
        {
          id: "duplicate-clients",
          title: "Possible duplicate clients",
          detail: `${duplicateCompanies.length} pair${duplicateCompanies.length === 1 ? "" : "s"} share a name, website or contact email and need review.`,
          why: "Duplicates split history, email context, tasks and deal intelligence.",
          href: "/crm#duplicates",
          examples: duplicateCompanies.slice(0, 3).map((pair) =>
            `${pair.records[0].name} / ${pair.records[1].name} (${pair.reason})`
          ),
        },
        { detail: "No likely duplicate client records found.", href: "/crm/board?tab=clients" }
      )
    );

    const duplicateTasks = findNearDuplicateTasks(tasks, 40);
    checks.push(
      atRisk(
        duplicateTasks.length,
        {
          id: "duplicate-tasks",
          title: "Possible duplicate to-dos",
          detail: `${duplicateTasks.length} open pair${duplicateTasks.length === 1 ? "" : "s"} look like the same action.`,
          why: "Duplicate actions create noise and can make finished work appear unfinished.",
          href: "/crm/board?tab=tasks",
          examples: duplicateTasks.slice(0, 3).map((pair) =>
            `${String(pair.first.text)} / ${String(pair.second.text)}`
          ),
        },
        { detail: "No likely duplicate open to-dos found.", href: "/crm/board?tab=tasks" }
      )
    );

    const brokenLinks = [
      ...contacts.map((row) => ({ type: "contact", ...row })),
      ...tasks.map((row) => ({ type: "to-do", ...row })),
      ...opportunities.map((row) => ({ type: "deal", ...row })),
      ...upcoming.map((row) => ({ type: "call", ...row })),
      ...summaries.map((row) => ({ type: "call summary", ...row })),
      ...drafts.map((row) => ({ type: "draft", ...row })),
    ].filter((row) => row.company_id && !companyIds.has(row.company_id));
    checks.push(
      atRisk(
        brokenLinks.length,
        {
          id: "broken-links",
          title: "Broken client links",
          detail: `${brokenLinks.length} record${brokenLinks.length === 1 ? " points" : "s point"} to a client that no longer exists.`,
          why: "Broken links produce dead ends and cause context to disappear from client pages.",
          href: "/crm/board?tab=clients",
          examples: brokenLinks.slice(0, 3).map((row) => `${titleCase(row.type)} ${row.id}`),
        },
        { detail: "All checked records point to valid clients.", href: "/crm/board?tab=clients" },
        "critical"
      )
    );

    const looseTasks = tasks.filter((task) => !task.company_id);
    checks.push(
      atRisk(
        looseTasks.length,
        {
          id: "unlinked-tasks",
          title: "Unlinked to-dos",
          detail: `${looseTasks.length} open to-do${looseTasks.length === 1 ? " is" : "s are"} not filed under a client.`,
          why: "Filing obvious actions under a client keeps the full relationship history together.",
          href: "/crm/board?tab=tasks",
          action: {
            label: "Link obvious ones",
            endpoint: "/api/crm/tasks/fold-loose",
            method: "POST",
          },
          examples: looseTasks.slice(0, 3).map((task) => String(task.text || "Untitled to-do")),
        },
        { detail: "Every open to-do is filed under a client.", href: "/crm/board?tab=tasks" }
      )
    );

    const externalUpcoming = upcoming.filter((call) => {
      if (call.company_id || !Array.isArray(call.attendees)) return false;
      return call.attendees.some((attendee: any) => {
        const email = String(attendee?.email || "").toLowerCase();
        if (!email || attendee?.self) return false;
        return !email.endsWith("@ai13.com") && !email.endsWith("@interviewa.com");
      });
    });
    checks.push(
      atRisk(
        externalUpcoming.length,
        {
          id: "unlinked-upcoming-calls",
          title: "Upcoming calls without a client",
          detail: `${externalUpcoming.length} external call${externalUpcoming.length === 1 ? " is" : "s are"} not linked to a client.`,
          why: "Unlinked calls cannot inherit email history, outreach research or the right next-call intent.",
          href: "/crm/calls",
          examples: externalUpcoming.slice(0, 3).map((call) => String(call.title || "Untitled call")),
        },
        { detail: "All detected external upcoming calls are linked to clients.", href: "/crm/calls" }
      )
    );

    const unlinkedSummaries = summaries.filter((summary) => !summary.company_id);
    checks.push(
      atRisk(
        unlinkedSummaries.length,
        {
          id: "unlinked-call-history",
          title: "Recent calls not filed",
          detail: `${unlinkedSummaries.length} call summar${unlinkedSummaries.length === 1 ? "y is" : "ies are"} not linked to a client in the last 30 days.`,
          why: "Unfiled summaries cannot strengthen commercial memory or the next call's intent.",
          href: "/crm/calls",
        },
        { detail: "All recent call summaries are filed under clients.", href: "/crm/calls" }
      )
    );

    const missingNextAction = opportunities.filter(
      (opportunity) => !String(opportunity.next_action || "").trim()
    );
    const missingStage = opportunities.filter(
      (opportunity) => !String(opportunity.pipeline_stage || "").trim()
    );
    const missingOwner = opportunities.filter(
      (opportunity) => !String(opportunity.next_action_owner || "").trim()
    );
    const missingDeadline = opportunities.filter(
      (opportunity) =>
        String(opportunity.next_action || "").trim() && !opportunity.next_action_due_at
    );
    const dealHygieneIds = new Set(
      [...missingNextAction, ...missingStage, ...missingOwner, ...missingDeadline].map(
        (opportunity) => opportunity.id
      )
    );
    const dealBreakdown = [
      missingNextAction.length ? `${missingNextAction.length} without a next action` : "",
      missingStage.length ? `${missingStage.length} without a stage` : "",
      missingOwner.length ? `${missingOwner.length} without an owner` : "",
      missingDeadline.length ? `${missingDeadline.length} without a deadline` : "",
    ].filter(Boolean);
    checks.push(
      atRisk(
        dealHygieneIds.size,
        {
          id: "deal-hygiene",
          title: "Deal next-step gaps",
          detail: `${dealHygieneIds.size} open revenue deal${dealHygieneIds.size === 1 ? " needs" : "s need"} attention: ${dealBreakdown.join("; ")}.`,
          why: "A deal without a clear owned next move is the easiest revenue to let drift.",
          href: "/crm/revenue",
          examples: [...dealHygieneIds].slice(0, 3).map((id) => {
            const row = opportunities.find((opportunity) => opportunity.id === id);
            return `${companyName.get(row?.company_id) || "Unlinked client"}: ${row?.title || "Untitled deal"}`;
          }),
        },
        { detail: "Every open revenue deal has a stage, next action, owner and deadline.", href: "/crm/revenue" }
      )
    );

    const activeCompanyIds = new Set(
      [...tasks, ...opportunities, ...upcoming]
        .map((row) => row.company_id)
        .filter(Boolean)
    );
    const stageGaps = companies.filter(
      (company) => activeCompanyIds.has(company.id) && !String(company.stage || "").trim()
    );
    checks.push(
      atRisk(
        stageGaps.length,
        {
          id: "client-stages",
          title: "Active clients without a stage",
          detail: `${stageGaps.length} active client${stageGaps.length === 1 ? " has" : "s have"} no relationship stage.`,
          why: "Stages make the client list sortable and stop active relationships being overlooked.",
          href: "/crm/board?tab=clients",
          examples: stageGaps.slice(0, 3).map((company) => company.name),
        },
        { detail: "Every active client has a relationship stage.", href: "/crm/board?tab=clients" }
      )
    );

    const staleDrafts = drafts.filter(
      (draft) => draft.created_at && new Date(draft.created_at).getTime() < now - 30 * DAY
    );
    checks.push(
      atRisk(
        staleDrafts.length,
        {
          id: "stale-drafts",
          title: "Old unsent drafts",
          detail: `${staleDrafts.length} draft${staleDrafts.length === 1 ? " is" : "s are"} still waiting after 30 days.`,
          why: "Old drafts usually represent a missed follow-up or content that is no longer current.",
          href: "/crm/board?tab=drafts",
          examples: staleDrafts.slice(0, 3).map((draft) => String(draft.draft_subject || "Untitled draft")),
        },
        { detail: "No unsent draft is older than 30 days.", href: "/crm/board?tab=drafts" }
      )
    );

    const pendingActivity = companies.filter(
      (company) => company.commercial_memory?.latestActivity?.status === "pending"
    );
    checks.push(
      atRisk(
        pendingActivity.length,
        {
          id: "pending-activity",
          title: "Pending activity plans",
          detail: `${pendingActivity.length} logged phone, text or relationship update${pendingActivity.length === 1 ? " still needs" : "s still need"} its proposed action confirmed.`,
          why: "Off-system conversations only become useful when their next move is accepted or changed.",
          href: pendingActivity[0] ? `/crm/${pendingActivity[0].id}#sec-quick-update` : "/crm/board?tab=clients",
          examples: pendingActivity.slice(0, 3).map((company) => company.name),
        },
        { detail: "No logged activity plan is waiting for approval.", href: "/crm/board?tab=clients" }
      )
    );

    const londonDay = (date: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    const todayKey = londonDay(new Date(now));
    const dayCost = new Map<string, number>();
    for (const row of usage) {
      if (!row.created_at) continue;
      const key = londonDay(new Date(row.created_at));
      dayCost.set(key, (dayCost.get(key) || 0) + (Number(row.cost_gbp) || 0));
    }
    const todayCost = dayCost.get(todayKey) || 0;
    let priorTotal = 0;
    for (let daysAgo = 1; daysAgo <= 7; daysAgo += 1) {
      priorTotal += dayCost.get(londonDay(new Date(now - daysAgo * DAY))) || 0;
    }
    const priorAverage = priorTotal / 7;
    const costSpike = todayCost >= 0.5 && todayCost > Math.max(priorAverage * 2, 0.5);
    checks.push({
      id: "ai-cost",
      title: "AI cost pattern",
      status: costSpike ? "attention" : "healthy",
      count: costSpike ? 1 : 0,
      detail: costSpike
        ? `Today is £${todayCost.toFixed(2)}, more than twice the previous seven-day daily average of £${priorAverage.toFixed(2)}.`
        : `Today is £${todayCost.toFixed(2)}; the previous seven-day daily average is £${priorAverage.toFixed(2)}. No unusual spike detected.`,
      why: "A sudden increase can reveal a loop or an unexpectedly expensive workflow before it compounds.",
      href: "/crm#costs",
    });

    // Highest-severity checks appear first, then stable alphabetical order.
    const rank: Record<HealthStatus, number> = {
      critical: 0,
      attention: 1,
      healthy: 2,
    };
    checks.sort(
      (a, b) => rank[a.status] - rank[b.status] || a.title.localeCompare(b.title)
    );
    const report: HealthReport = {
      generatedAt: new Date().toISOString(),
      overall: healthOverall(checks),
      totals: healthTotals(checks),
      checks,
      modelFree: true,
    };
    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "The CRM health check could not read live data.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, max-age=0" },
      }
    );
  }
}
