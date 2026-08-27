import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { londonDayBounds } from "@/lib/outreach";
import { buildWorkCleanup } from "@/lib/work-cleanup";
import {
  buildWorkPipeline,
  type WorkInboxItem,
  type WorkInboxResponse,
} from "@/lib/work-inbox";
import { requireRequestScope } from "@/lib/request-scope";
import { loadVisibleOpportunities } from "@/lib/opportunity-access";
import {
  loadSafeSharedCompanies,
  listVisibleClientGrants,
} from "@/lib/team-client-sharing";

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

const actionKey = (companyId: unknown, value: unknown) => {
  const action = text(value)
    .toLocaleLowerCase("en-GB")
    .replace(/\s+/g, " ");
  return companyId && action ? `${String(companyId)}\u0000${action}` : "";
};

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
    const account = requireRequestScope();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const endTodayMs = new Date(londonDayBounds().end).getTime();

    const [
      tasksResult,
      upcomingResult,
      ownedCompaniesResult,
      opportunities,
      followUpsResult,
      outreachMessagesResult,
      outreachProspectsResult,
      outreachMeetingsResult,
      visibleClientGrants,
    ] = await Promise.all([
      supabaseAdmin
        .from("tasks")
        .select("id,company_id,text,kind,link_kind,status,done_at,created_at,payload,due_at,source_ref")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .in("status", ["open", "done"])
        .order("created_at", { ascending: false })
        .limit(600),
      supabaseAdmin
        .from("upcoming_calls")
        .select("id,company_id,title,scheduled_at,intent,research,prepped,created_at")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .eq("prepped", false)
        .is("completed_at", null)
        .gte("scheduled_at", new Date(nowMs - 3 * 60 * 60 * 1000).toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(250),
      supabaseAdmin
        .from("companies")
        .select("id,name,stage,profile,commercial_memory")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .limit(1500),
      loadVisibleOpportunities<any>(account, {
        select:
          "id,company_id,title,value,pipeline_stage,win_outlook,next_action,next_action_due_at,next_action_owner,pipeline_stage_override,next_action_override,engagement_motion,active_contact_method,last_meaningful_activity_at,updated_at,workspace_id,owner_id,visibility,opportunity_type,assigned_to_user_id",
        status: "open",
        opportunityType: "revenue",
        orderBy: "updated_at",
        ascending: false,
        limit: 1000,
      }).then((rows) =>
        rows.filter(
          (opportunity) =>
            opportunity.assigned_to_user_id === account.userId
        )
      ),
      supabaseAdmin
        .from("follow_ups")
        .select("id,company_id,draft_subject,draft_body,status,created_at")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .in("status", ["draft", "sent"])
        .order("created_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("outreach_messages")
        .select("id,prospect_id,subject,body_text,status,step_number,created_at,updated_at,sent_at,scheduled_at")
        .eq("workspace_id", account.workspaceId)
        .eq("sender_user_id", account.userId)
        .in("status", ["draft", "approved", "sent", "failed"])
        .order("updated_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("outreach_prospects")
        .select("id,first_name,last_name,job_title,email,company_name,reply_category,reply_summary,last_reply_text,last_reply_at,status,crm_company_id,last_contacted_at,next_action_at,source_metadata")
        .eq("workspace_id", account.workspaceId)
        .eq("assigned_to_user_id", account.userId)
        .order("updated_at", { ascending: false })
        .limit(2000),
      supabaseAdmin
        .from("outreach_events")
        .select("prospect_id")
        .eq("workspace_id", account.workspaceId)
        .eq("kind", "meeting_booked")
        .limit(5000),
      listVisibleClientGrants(account.workspaceId),
    ]);

    const firstError = [
      tasksResult.error,
      upcomingResult.error,
      ownedCompaniesResult.error,
      followUpsResult.error,
      outreachMessagesResult.error,
      outreachProspectsResult.error,
      outreachMeetingsResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const assignedSharedClientIds = visibleClientGrants
      .filter(
        (grant) =>
          grant.status === "active" &&
          grant.assigned_to_user_id === account.userId
      )
      .map((grant) => grant.company_id);
    const assignedOpportunityCompanyIds = opportunities
      .map((opportunity: any) => opportunity.company_id)
      .filter(Boolean);
    const sharedCompanies = await loadSafeSharedCompanies(
      [...new Set([
        ...assignedSharedClientIds,
        ...assignedOpportunityCompanyIds,
      ])],
      account.workspaceId
    );
    const ownedCompanyIds = new Set(
      (ownedCompaniesResult.data || []).map((company: any) => company.id)
    );
    const companies = [
      ...(ownedCompaniesResult.data || []),
      ...sharedCompanies.filter((company) => !ownedCompanyIds.has(company.id)),
    ];
    const companyName = new Map(
      companies.map((company: any) => [company.id, text(company.name, 160)])
    );
    const revenueCompanies = new Set(
      opportunities
        .map((opportunity: any) => opportunity.company_id)
        .filter(Boolean)
    );
    const items: WorkInboxItem[] = [];
    const canonicalOpportunityActions = new Set(
      opportunities
        .map((opportunity: any) =>
          actionKey(opportunity.company_id, opportunity.next_action)
        )
        .filter(Boolean)
    );
    const pipelineBuild = buildWorkPipeline({
      opportunities,
      companyName,
      nowMs,
      endTodayMs,
    });
    items.push(...pipelineBuild.items);

    for (const task of tasksResult.data || []) {
      const done = task.status === "done";
      // A deal's canonical next action is already shown as an opportunity card.
      // Hide an exact open task copy so the salesperson never performs or
      // counts the same move twice. Completed task history remains visible.
      if (
        !done &&
        canonicalOpportunityActions.has(actionKey(task.company_id, task.text))
      ) {
        continue;
      }
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
      const outreach = call.research?.outreach;
      const company =
        companyName.get(call.company_id) || text(outreach?.companyName, 160) || null;
      const key = `${String(call.title || "").toLowerCase().trim()}:${call.company_id || outreach?.prospectId || "unlinked"}`;
      if (key && seenMeetings.has(key)) continue;
      if (key) seenMeetings.add(key);
      const scheduledMs = dateMs(call.scheduled_at);
      const within48Hours = scheduledMs != null && scheduledMs <= nowMs + 48 * 60 * 60 * 1000;
      const fromOutreach = Boolean(outreach?.prospectId);
      const revenue = fromOutreach || revenueCompanies.has(call.company_id);
      const priority = fromOutreach && within48Hours ? 108 : within48Hours ? 94 : revenue ? 76 : 64;
      items.push({
        id: `prep:${call.id}`,
        sourceId: call.id,
        kind: "prep",
        title: `Prepare: ${text(call.title, 240) || "upcoming call"}`,
        detail: fromOutreach
          ? call.company_id
            ? "Booked from outreach · client linked · suggested intent ready"
            : "Booked from outreach · review the CRM company match"
          : !call.company_id
            ? "Client not linked yet · link or create it before relationship prep"
          : within48Hours
            ? "Call is within 48 hours"
            : "Upcoming call",
        company,
        companyId: call.company_id || null,
        href: call.company_id
          ? `/crm/prep?upcoming=${call.id}`
          : `/call?upcoming=${call.id}`,
        priority,
        priorityLabel: priorityLabel(priority),
        dueAt: call.scheduled_at || null,
        createdAt: call.created_at || null,
        revenue,
        approval: fromOutreach,
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
    const previousSentByProspect = new Map<string, any>();
    for (const message of outreachMessagesResult.data || []) {
      if (
        message.status !== "sent" ||
        Number(message.step_number) === 10 ||
        !message.prospect_id
      )
        continue;
      const existing = previousSentByProspect.get(message.prospect_id);
      if (
        !existing ||
        (dateMs(message.sent_at) || 0) > (dateMs(existing.sent_at) || 0)
      ) {
        previousSentByProspect.set(message.prospect_id, message);
      }
    }
    const replyContext = (prospect: any, message?: any) => {
      const previous = previousSentByProspect.get(prospect.id);
      const person = [prospect.first_name, prospect.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      return {
        prospectId: prospect.id,
        person: person || null,
        email: text(prospect.email, 320) || null,
        jobTitle: text(prospect.job_title, 240) || null,
        messageId: message?.id || null,
        messageStatus: message?.status || null,
        draftSubject: text(message?.subject, 180) || null,
        draftBody: text(message?.body_text, 4000) || null,
        replyText: text(prospect.last_reply_text, 4000) || null,
        replySummary: text(prospect.reply_summary, 500) || null,
        lastReplyAt: prospect.last_reply_at || null,
        previousSubject: text(previous?.subject, 180) || null,
        previousBody: text(previous?.body_text, 4000) || null,
        previousSentAt: previous?.sent_at || null,
      };
    };
    const replyDraftProspects = new Set<string>();
    const handledReplyProspects = new Set<string>(
      (outreachMeetingsResult.data || [])
        .map((event: any) => event.prospect_id)
        .filter(Boolean)
    );
    const handledReplyRefs = new Set(
      (tasksResult.data || [])
        .map((task: any) => text(task.source_ref, 500))
        .filter((sourceRef) => sourceRef.startsWith("outreach-reply:"))
    );
    for (const message of outreachMessagesResult.data || []) {
      const prospect: any = prospects.get(message.prospect_id);
      const done = message.status === "sent";
      const isReply = Number(message.step_number) === 10;
      if (isReply && message.status === "approved" && message.scheduled_at) {
        handledReplyProspects.add(message.prospect_id);
        continue;
      }
      if (message.status === "approved" && message.scheduled_at) continue;
      const sentMs = dateMs(message.sent_at);
      if (isReply && !done) replyDraftProspects.add(message.prospect_id);
      if (isReply && done) handledReplyProspects.add(message.prospect_id);
      if (done && (!sentMs || sentMs < nowMs - 7 * DAY_MS)) continue;
      const person = [prospect?.first_name, prospect?.last_name].filter(Boolean).join(" ");
      const priority = done ? 0 : message.status === "approved" ? 106 : isReply ? 103 : 92;
      items.push({
        id: isReply ? `reply-draft:${message.id}` : `outreach:${message.id}`,
        sourceId: isReply ? message.prospect_id : message.id,
        kind: isReply ? "reply" : "outreach",
        title:
          message.status === "approved"
            ? `Send approved email to ${person || prospect?.company_name || "prospect"}`
            : isReply
              ? `Reply to ${person || prospect?.company_name || "prospect"}`
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
        ...(isReply && prospect
          ? { outreach: replyContext(prospect, message) }
          : {}),
      });
    }

    for (const prospect of outreachProspectsResult.data || []) {
      const latestManualCall = prospect.source_metadata?.latest_manual_call;
      const manualNextAction = text(latestManualCall?.nextAction, 360);
      const manualDueAt = prospect.next_action_at || latestManualCall?.nextActionAt || null;
      if (
        latestManualCall &&
        manualNextAction &&
        !["not_interested", "do_not_contact"].includes(latestManualCall.outcome)
      ) {
        const person = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ");
        const dueMs = dateMs(manualDueAt);
        const overdue = dueMs != null && dueMs < nowMs;
        const dueToday = dueMs != null && dueMs < endTodayMs;
        const priority = overdue ? 109 : dueToday ? 101 : 84;
        items.push({
          id: `manual-call-next:${prospect.id}:${latestManualCall.requestId || latestManualCall.eventId}`,
          sourceId: prospect.id,
          kind: "outreach",
          title: manualNextAction,
          detail: text(
            latestManualCall.interpretation?.summary || latestManualCall.notePreview,
            240
          ) || `Manual call logged with ${person || prospect.company_name || "prospect"}`,
          company: text(prospect.company_name, 160) || null,
          companyId: prospect.crm_company_id || null,
          href: "/crm/outreach?tab=prospects",
          priority,
          priorityLabel: priorityLabel(priority),
          dueAt: manualDueAt,
          createdAt: latestManualCall.occurredAt || prospect.last_contacted_at || null,
          revenue: true,
          approval: false,
          waiting: false,
          done: false,
          editable: false,
          dismissible: false,
        });
      }
      if (
        !prospect.last_reply_at ||
        prospect.reply_category !== "interested" ||
        handledReplyRefs.has(
          `outreach-reply:${prospect.id}:${prospect.last_reply_at}`
        ) ||
        replyDraftProspects.has(prospect.id) ||
        handledReplyProspects.has(prospect.id)
      )
        continue;
      const person = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ");
      const companyId = prospect.crm_company_id || null;
      items.push({
        id: `reply:${prospect.id}`,
        sourceId: prospect.id,
        kind: "reply",
        title: companyId
          ? `${person || prospect.company_name || "A prospect"} replied positively`
          : `Review CRM handover for ${person || prospect.company_name || "a prospect"}`,
        detail: companyId
          ? text(prospect.reply_summary, 240) || "Prepare a concise booking reply"
          : "Identity needs approval before a client profile is linked or created",
        company: text(prospect.company_name, 160) || null,
        companyId,
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
        outreach: replyContext(prospect),
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
    const cleanup = buildWorkCleanup(
      (tasksResult.data || []) as any[],
      companyName,
      revenueCompanies,
      nowMs
    );
    const response: WorkInboxResponse = {
      generatedAt: nowIso,
      viewer: {
        userId: account.userId,
        role: account.role,
      },
      items,
      pipeline: pipelineBuild.summary,
      cleanup,
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
