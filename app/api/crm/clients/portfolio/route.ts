import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const [
      { data: companies, error: companiesError },
      { data: contacts, error: contactsError },
      { data: opportunities, error: opportunitiesError },
      { data: tasks, error: tasksError },
      { data: calls, error: callsError },
      { data: upcoming, error: upcomingError },
    ] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id,name,domain,website,sector,stage,profile,attributes,commercial_memory,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("contacts")
        .select("id,company_id,name,role,email,attributes,created_at")
        .not("company_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(3000),
      supabaseAdmin
        .from("opportunities")
        .select("id,company_id,title,value,status,opportunity_type,pipeline_stage,probability,next_action,next_action_due_at,updated_at")
        .eq("status", "open")
        .eq("opportunity_type", "revenue")
        .order("updated_at", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("tasks")
        .select("id,company_id,text,kind,due_at,created_at")
        .eq("status", "open")
        .not("company_id", "is", null)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(3000),
      supabaseAdmin
        .from("interview_summaries")
        .select("company_id,created_at")
        .not("company_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(3000),
      supabaseAdmin
        .from("upcoming_calls")
        .select("company_id,title,scheduled_at")
        .not("company_id", "is", null)
        .is("completed_at", null)
        .gte("scheduled_at", nowIso)
        .order("scheduled_at", { ascending: true })
        .limit(1000),
    ]);

    const firstError = [
      companiesError,
      contactsError,
      opportunitiesError,
      tasksError,
      callsError,
      upcomingError,
    ].find(Boolean);
    if (firstError) throw firstError;

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

    const lastCallByCompany = new Map<string, number>();
    for (const call of calls || []) {
      if (!call.company_id || lastCallByCompany.has(call.company_id)) continue;
      const ms = validDateMs(call.created_at);
      if (ms != null) lastCallByCompany.set(call.company_id, ms);
    }

    const nextMeetingByCompany = new Map<string, any>();
    for (const meeting of upcoming || []) {
      if (meeting.company_id && !nextMeetingByCompany.has(meeting.company_id)) {
        nextMeetingByCompany.set(meeting.company_id, meeting);
      }
    }

    const clients = (companies || [])
      .filter((company: any) => company.profile?.internal !== true)
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
      const emailMs = validDateMs(profile.email_last_message_at);
      const callMs = lastCallByCompany.get(company.id) || null;
      const outreachMs = Math.max(
        validDateMs(memory.outreach?.lastReplyAt) || 0,
        validDateMs(memory.outreach?.lastContactedAt) || 0
      ) || null;
      const lastTouchMs = Math.max(emailMs || 0, callMs || 0, outreachMs || 0) || null;
      const lastTouchAt = lastTouchMs ? new Date(lastTouchMs).toISOString() : null;
      const daysQuiet = lastTouchMs
        ? Math.max(0, Math.floor((nowMs - lastTouchMs) / DAY_MS))
        : null;

      const reasons: string[] = [];
      let health: "red" | "amber" | "green" | "grey" = "grey";
      if (overdue) reasons.push("Overdue next action");
      if (opportunity && !nextActionText) reasons.push("Opportunity has no next action");
      if (opportunity && !nextMeeting) reasons.push("No next meeting booked");
      if (!primaryContact) reasons.push("No contact recorded");
      if (!company.stage) reasons.push("Relationship stage missing");
      if (daysQuiet != null && daysQuiet >= 21) reasons.push(`Quiet for ${daysQuiet} days`);

      if (overdue || (opportunity && daysQuiet != null && daysQuiet >= 21)) {
        health = "red";
      } else if (
        reasons.length > 0 ||
        (daysQuiet != null && daysQuiet >= 7) ||
        (openTasks.length > 0 && !nextMeeting)
      ) {
        health = "amber";
        if (daysQuiet != null && daysQuiet >= 7 && daysQuiet < 21) {
          reasons.unshift(`Quiet for ${daysQuiet} days`);
        }
      } else if (nextMeeting || (daysQuiet != null && daysQuiet < 7)) {
        health = "green";
        reasons.push(nextMeeting ? "Next meeting booked" : "Recently active");
      } else {
        reasons.push("Not enough activity data yet");
      }

      const lastCall = memory.lastCall && typeof memory.lastCall === "object" ? memory.lastCall : {};
      const buyingSignal =
        firstText(lastCall.buyingSignals) || firstText(lastCall.commercialOpportunities);
      const stage = String(company.stage || opportunity?.pipeline_stage || "").trim();

      return {
        id: company.id,
        name: company.name,
        sector: company.sector || null,
        relationshipStage: company.stage || null,
        category:
          opportunity
            ? "Opportunity"
            : String(company.stage || "").toLowerCase() === "customer"
              ? "Customer"
              : "Relationship",
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
            acc.all += 1;
            acc[client.health] += 1;
            if (client.opportunity) acc.opportunities += 1;
            return acc;
          },
          { all: 0, red: 0, amber: 0, green: 0, grey: 0, opportunities: 0 }
        ),
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to load client portfolio" },
      { status: 500 }
    );
  }
}
