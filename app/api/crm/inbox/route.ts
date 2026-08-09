import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { londonDayBounds } from "@/lib/outreach";
import type { WorkInboxItem, WorkInboxResponse } from "@/lib/work-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

const dateMs = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const text = (value: unknown, max = 500) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const priorityLabel = (score: number, waiting = false, done = false) => {
  if (done) return "done" as const;
  if (waiting) return "waiting" as const;
  if (score >= 95) return "urgent" as const;
  if (score >= 78) return "high" as const;
  return "normal" as const;
};

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

// One factual, model-free read for the entire Work Inbox. It deliberately
// combines existing records instead of copying them into another table, so an
// edit or tick is immediately authoritative everywhere in the CRM.
export async function GET() {
  try {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const endTodayMs = new Date(londonDayBounds().end).getTime();

    const [
      tasksResult,
      upcomingResult,
      companiesResult,
      opportunitiesResult,
      followUpsResult,
      outreachMessagesResult,
      outreachProspectsResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("tasks")
        .select("id,company_id,text,kind,link_kind,status,done_at,created_at,payload,due_at")
        .in("status", ["open", "done"])
        .order("created_at", { ascending: false })
        .limit(600),
      supabaseAdmin
        .from("upcoming_calls")
        .select("id,company_id,title,scheduled_at,prepped,created_at")
        .not("company_id", "is", null)
        .eq("prepped", false)
        .is("completed_at", null)
        .gte("scheduled_at", new Date(nowMs - 3 * 60 * 60 * 1000).toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(250),
      supabaseAdmin
        .from("companies")
        .select("id,name,stage,profile,commercial_memory")
        .limit(1500),
      supabaseAdmin
        .from("opportunities")
        .select("company_id")
        .eq("status", "open")
        .eq("opportunity_type", "revenue")
        .limit(1000),
      supabaseAdmin
        .from("follow_ups")
        .select("id,company_id,draft_subject,draft_body,status,created_at")
        .in("status", ["draft", "sent"])
        .order("created_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("outreach_messages")
        .select("id,prospect_id,subject,body_text,status,step_number,created_at,updated_at,sent_at")
        .in("status", ["draft", "approved", "sent"])
        .order("updated_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("outreach_prospects")
        .select("id,first_name,last_name,company_name,reply_category,reply_summary,last_reply_at,status")
        .not("last_reply_at", "is", null)
        .order("last_reply_at", { ascending: false })
        .limit(200),
    ]);

    const firstError = [
      tasksResult.error,
      upcomingResult.error,
      companiesResult.error,
      opportunitiesResult.error,
      followUpsResult.error,
      outreachMessagesResult.error,
      outreachProspectsResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const companies = companiesResult.data || [];
    const companyName = new Map(
      companies.map((company: any) => [company.id, text(company.name, 160)])
    );
    const revenueCompanies = new Set(
      (opportunitiesResult.data || [])
        .map((opportunity: any) => opportunity.company_id)
        .filter(Boolean)
    );
    const items: WorkInboxItem[] = [];

    for (const task of tasksResult.data || []) {
      const done = task.status === "done";
      const doneMs = dateMs(task.done_at);
      if (done && (!doneMs || doneMs < nowMs - 7 * DAY_MS)) continue;
      const dueMs = dateMs(task.due_at);
      const overdue = !done && dueMs != null && dueMs < nowMs;
      const dueToday = !done && dueMs != null && dueMs < endTodayMs;
      const waiting = !done && task.kind === "counterparty_commitment";
      const revenue = revenueCompanies.has(task.company_id);
      const pinned = task.payload?.pinned === true;
      let priority = done ? 0 : waiting ? 38 : 56;
      if (task.kind === "commitment") priority += 10;
      if (task.link_kind === "email") priority += 7;
      if (revenue) priority += 12;
      if (dueToday) priority = Math.max(priority, 90);
      if (overdue) priority = Math.max(priority, 98);
      if (pinned) priority = Math.max(priority, 102);
      const company = task.company_id ? companyName.get(task.company_id) || null : null;
      items.push({
        id: `task:${task.id}`,
        sourceId: task.id,
        kind: "task",
        title: text(task.text),
        detail: waiting
          ? "Waiting for someone else"
          : overdue
            ? "Deadline has passed"
            : task.link_kind === "email"
              ? "Email action"
              : null,
        company,
        companyId: task.company_id || null,
        href: task.company_id ? `/crm/${task.company_id}` : "/crm/board?tab=tasks",
        priority,
        priorityLabel: priorityLabel(priority, waiting, done),
        dueAt: done ? task.done_at || null : task.due_at || null,
        createdAt: task.created_at || null,
        revenue,
        approval: false,
        waiting,
        done,
        editable: !done,
        dismissible: !done,
      });
    }

    // Recurring meetings appear once, using only their next instance.
    const seenMeetings = new Set<string>();
    for (const call of upcomingResult.data || []) {
      const company = companyName.get(call.company_id) || null;
      const key = `${String(call.title || "").toLowerCase().trim()}:${call.company_id}`;
      if (key && seenMeetings.has(key)) continue;
      if (key) seenMeetings.add(key);
      const scheduledMs = dateMs(call.scheduled_at);
      const within48Hours = scheduledMs != null && scheduledMs <= nowMs + 48 * 60 * 60 * 1000;
      const revenue = revenueCompanies.has(call.company_id);
      const priority = within48Hours ? 94 : revenue ? 76 : 64;
      items.push({
        id: `prep:${call.id}`,
        sourceId: call.id,
        kind: "prep",
        title: `Prepare: ${text(call.title, 240) || "upcoming call"}`,
        detail: within48Hours ? "Call is within 48 hours" : "Upcoming call",
        company,
        companyId: call.company_id || null,
        href: `/crm/prep?upcoming=${call.id}`,
        priority,
        priorityLabel: priorityLabel(priority),
        dueAt: call.scheduled_at || null,
        createdAt: call.created_at || null,
        revenue,
        approval: false,
        waiting: false,
        done: false,
        editable: false,
        dismissible: false,
      });
    }

    for (const followUp of followUpsResult.data || []) {
      const done = followUp.status === "sent";
      const createdMs = dateMs(followUp.created_at);
      if (done && (!createdMs || createdMs < nowMs - 7 * DAY_MS)) continue;
      const revenue = revenueCompanies.has(followUp.company_id);
      const priority = done ? 0 : revenue ? 88 : 76;
      items.push({
        id: `follow_up:${followUp.id}`,
        sourceId: followUp.id,
        kind: "follow_up",
        title: text(followUp.draft_subject, 240) || "Review follow-up draft",
        detail: text(followUp.draft_body, 180) || "Follow-up email ready to review",
        company: companyName.get(followUp.company_id) || null,
        companyId: followUp.company_id || null,
        href: "/crm/board?tab=drafts",
        priority,
        priorityLabel: priorityLabel(priority, false, done),
        dueAt: null,
        createdAt: followUp.created_at || null,
        revenue,
        approval: !done,
        waiting: false,
        done,
        editable: false,
        dismissible: !done,
      });
    }

    const prospects = new Map(
      (outreachProspectsResult.data || []).map((prospect: any) => [prospect.id, prospect])
    );
    const replyDraftProspects = new Set<string>();
    for (const message of outreachMessagesResult.data || []) {
      const prospect: any = prospects.get(message.prospect_id);
      const done = message.status === "sent";
      const sentMs = dateMs(message.sent_at);
      if (done && (!sentMs || sentMs < nowMs - 7 * DAY_MS)) continue;
      const isReply = Number(message.step_number) === 10;
      if (isReply && !done) replyDraftProspects.add(message.prospect_id);
      const person = [prospect?.first_name, prospect?.last_name].filter(Boolean).join(" ");
      const priority = done ? 0 : message.status === "approved" ? 106 : isReply ? 103 : 92;
      items.push({
        id: `outreach:${message.id}`,
        sourceId: message.id,
        kind: "outreach",
        title:
          message.status === "approved"
            ? `Send approved email to ${person || prospect?.company_name || "prospect"}`
            : `Review email for ${person || prospect?.company_name || "prospect"}`,
        detail: text(message.subject, 180) || (isReply ? "Booking reply" : "Outreach draft"),
        company: text(prospect?.company_name, 160) || null,
        companyId: null,
        href: isReply ? "/crm/outreach?tab=replies" : "/crm/outreach?tab=queue",
        priority,
        priorityLabel: priorityLabel(priority, false, done),
        dueAt: null,
        createdAt: message.updated_at || message.created_at || message.sent_at || null,
        revenue: true,
        approval: !done,
        waiting: false,
        done,
        editable: false,
        dismissible: false,
      });
    }

    for (const prospect of outreachProspectsResult.data || []) {
      if (
        prospect.reply_category !== "interested" ||
        replyDraftProspects.has(prospect.id)
      )
        continue;
      const person = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ");
      items.push({
        id: `reply:${prospect.id}`,
        sourceId: prospect.id,
        kind: "reply",
        title: `${person || prospect.company_name || "A prospect"} replied positively`,
        detail: text(prospect.reply_summary, 240) || "Prepare a concise booking reply",
        company: text(prospect.company_name, 160) || null,
        companyId: null,
        href: "/crm/outreach?tab=replies",
        priority: 110,
        priorityLabel: "urgent",
        dueAt: prospect.last_reply_at || null,
        createdAt: prospect.last_reply_at || null,
        revenue: true,
        approval: true,
        waiting: false,
        done: false,
        editable: false,
        dismissible: false,
      });
    }

    for (const company of companies) {
      const profile = company.profile && typeof company.profile === "object" ? company.profile : {};
      const memory =
        company.commercial_memory && typeof company.commercial_memory === "object"
          ? company.commercial_memory
          : {};
      const intelligence = [
        (profile as any).activity_intelligence?.latest,
        (memory as any).latestActivity,
      ].find((candidate) => candidate?.status === "pending");
      if (!intelligence) continue;
      const revenue = revenueCompanies.has(company.id);
      const priority = revenue ? 100 : 91;
      items.push({
        id: `client_update:${company.id}`,
        sourceId: company.id,
        kind: "client_update",
        title: `Review ${text(company.name, 160)} update`,
        detail: text(intelligence.overview || intelligence.nextAction, 240) || "Apply or reject the proposed CRM changes",
        company: text(company.name, 160),
        companyId: company.id,
        href: `/crm/${company.id}#sec-quick-update`,
        priority,
        priorityLabel: priorityLabel(priority),
        dueAt: intelligence.createdAt || intelligence.at || null,
        createdAt: intelligence.createdAt || intelligence.at || null,
        revenue,
        approval: true,
        waiting: false,
        done: false,
        editable: false,
        dismissible: false,
      });
    }

    items.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      const aDue = dateMs(a.dueAt) ?? Number.POSITIVE_INFINITY;
      const bDue = dateMs(b.dueAt) ?? Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return (dateMs(b.createdAt) || 0) - (dateMs(a.createdAt) || 0);
    });

    const counts = {
      now: items.filter(
        (item) => !item.done && !item.waiting && item.priority >= 78
      ).length,
      urgent: items.filter((item) => !item.done && item.priorityLabel === "urgent").length,
      revenue: items.filter((item) => !item.done && item.revenue).length,
      approvals: items.filter((item) => !item.done && item.approval).length,
      waiting: items.filter((item) => !item.done && item.waiting).length,
      done: items.filter((item) => item.done).length,
      all: items.filter((item) => !item.done).length,
    };
    const response: WorkInboxResponse = {
      generatedAt: nowIso,
      items,
      counts,
    };
    return NextResponse.json(response, { headers: noStore });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to load work inbox" },
      { status: 500, headers: noStore }
    );
  }
}
