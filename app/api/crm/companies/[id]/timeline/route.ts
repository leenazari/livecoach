import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TimelineType =
  | "call"
  | "email"
  | "commitment"
  | "task"
  | "opportunity"
  | "note"
  | "follow_up"
  | "meeting"
  | "outreach";

type TimelineItem = {
  id: string;
  type: TimelineType;
  at: string;
  title: string;
  detail?: string;
  status?: string;
  meta?: string;
  href?: string;
  future?: boolean;
};

const text = (value: any, max = 260): string => {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).replace(/\s+\S*$/, "") + "…" : clean;
};

// One factual relationship history assembled from existing CRM records. No AI
// pass is needed to open it, so the client page stays instant and token-free.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const now = Date.now();
    const [
      { data: company },
      { data: calls },
      { data: tasks },
      { data: followUps },
      { data: opportunities },
      { data: context },
      { data: upcoming },
      { data: outreachProspects },
    ] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("notes, updated_at, email_context, email_context_updated_at")
        .eq("owner_id", scope.userId)
        .eq("id", params.id)
        .maybeSingle(),
      supabaseAdmin
        .from("interview_summaries")
        .select("id, session_id, candidate, summary, created_at")
        .eq("owner_id", scope.userId)
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("tasks")
        .select("id, text, kind, status, created_at, done_at, due_at, payload")
        .eq("owner_id", scope.userId)
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(150),
      supabaseAdmin
        .from("follow_ups")
        .select("id, draft_subject, status, created_at")
        .eq("owner_id", scope.userId)
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("opportunities")
        .select("id, title, detail, value, status, pipeline_stage, probability, next_action, next_action_due_at, next_action_owner, created_at, updated_at")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(80),
      supabaseAdmin
        .from("client_context")
        .select("id, kind, title, url, content, created_at")
        .eq("owner_id", scope.userId)
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(80),
      supabaseAdmin
        .from("upcoming_calls")
        .select("id, title, scheduled_at, intent, prepped, completed_at")
        .eq("owner_id", scope.userId)
        .eq("company_id", params.id)
        .is("completed_at", null)
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(20),
      supabaseAdmin
        .from("outreach_prospects")
        .select("id, first_name, last_name, email, company_name")
        .eq("crm_company_id", params.id)
        .limit(50),
    ]);

    const prospectIds = (outreachProspects || []).map((prospect: any) => prospect.id);
    const outreachEvents = prospectIds.length
      ? (
          await supabaseAdmin
            .from("outreach_events")
            .select("id, prospect_id, message_id, kind, metadata, created_at")
            .in("prospect_id", prospectIds)
            .order("created_at", { ascending: false })
            .limit(150)
        ).data || []
      : [];
    const messageIds = [...new Set(outreachEvents.map((event: any) => event.message_id).filter(Boolean))];
    const outreachMessages = messageIds.length
      ? (
          await supabaseAdmin
            .from("outreach_messages")
            .select("id, subject")
            .in("id", messageIds)
        ).data || []
      : [];

    const items: TimelineItem[] = [];
    const prospectById = new Map((outreachProspects || []).map((prospect: any) => [prospect.id, prospect]));
    const subjectByMessageId = new Map((outreachMessages || []).map((message: any) => [message.id, message.subject]));
    const outreachLabels: Record<string, string> = {
      queued: "Added to outreach queue",
      researched: "Prospect research completed",
      drafted: "Outreach email drafted",
      approved: "Outreach email approved",
      sent: "Outreach email sent",
      reply: "Outreach reply received",
      positive_reply: "Interested reply received",
      objection: "Prospect raised an objection",
      later: "Prospect asked to reconnect later",
      referral: "Prospect made a referral",
      unsubscribe: "Prospect opted out",
      meeting_booked: "Meeting booked from outreach",
      booking_link_shared: "Booking link shared",
      crm_created: "Outreach prospect became a CRM relationship",
      learning_promoted: "Campaign learning promoted",
      failed: "Outreach action failed",
    };
    for (const event of outreachEvents) {
      const prospect: any = prospectById.get(event.prospect_id);
      const who = [prospect?.first_name, prospect?.last_name].filter(Boolean).join(" ");
      const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
      const subject = subjectByMessageId.get(event.message_id) || metadata.subject || "";
      const reply = metadata.reply_summary || metadata.summary || metadata.reply_text || "";
      items.push({
        id: `outreach:${event.id}`,
        type: "outreach",
        at: event.created_at,
        title: outreachLabels[event.kind] || `Outreach: ${text(event.kind, 80)}`,
        detail: text(reply || subject, 300),
        status: text(event.kind, 40),
        meta: text(who || prospect?.email || prospect?.company_name, 100),
        href: "/crm/outreach",
      });
    }
    const seenSessions = new Set<string>();
    for (const c of calls || []) {
      const session = String(c.session_id || "");
      if (session && seenSessions.has(session)) continue;
      if (session) seenSessions.add(session);
      const summary = c.summary && typeof c.summary === "object" ? c.summary : {};
      const title = text((summary as any).title || c.candidate || "Call", 120);
      const overview = text(
        (summary as any).headline || (summary as any).overview || "",
        300
      );
      const actions = Array.isArray((summary as any).myNextActions)
        ? (summary as any).myNextActions.length
        : Array.isArray((summary as any).actions)
        ? (summary as any).actions.length
        : 0;
      items.push({
        id: `call:${c.id}`,
        type: "call",
        at: c.created_at,
        title,
        detail: overview,
        meta: actions ? `${actions} next ${actions === 1 ? "action" : "actions"}` : undefined,
        href: `/crm/calls/${c.id}`,
      });
    }

    for (const t of tasks || []) {
      const commitment =
        t.kind === "commitment" || t.kind === "counterparty_commitment";
      const owner =
        t.payload && typeof t.payload === "object"
          ? String(t.payload.ownerName || "").trim()
          : "";
      const due = t.due_at ? new Date(t.due_at).getTime() : null;
      items.push({
        id: `task:${t.id}`,
        type: commitment ? "commitment" : "task",
        at: t.done_at || t.created_at,
        title: text(t.text, 180),
        status: t.status,
        meta:
          t.status === "done"
            ? owner
              ? `${owner} · completed`
              : "completed"
            : due && due < now
            ? owner
              ? `${owner} · overdue`
              : "overdue"
            : due
            ? `${owner ? `${owner} · ` : ""}due ${new Date(due).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short" })}`
            : owner || undefined,
        href: "/crm/board?tab=tasks",
      });
    }

    for (const f of followUps || []) {
      items.push({
        id: `follow:${f.id}`,
        type: "follow_up",
        at: f.created_at,
        title: text(f.draft_subject || "Follow-up email", 160),
        status: f.status,
        meta: f.status === "draft" ? "ready to review" : f.status,
        href: "/crm/board?tab=drafts",
      });
    }

    for (const o of opportunities || []) {
      const value = Number(o.value) || 0;
      const stage = text(String(o.pipeline_stage || o.status || "").replace(/_/g, " "), 60);
      const owner = o.next_action_owner === "buyer"
        ? "buyer owns next step"
        : o.next_action_owner === "joint"
          ? "joint next step"
          : "we own next step";
      const nextAction = text(o.next_action, 220);
      items.push({
        id: `opp:${o.id}`,
        type: "opportunity",
        at: o.updated_at || o.created_at,
        title: text(o.title || "Opportunity", 160),
        detail: nextAction ? `Next: ${nextAction}` : text(o.detail, 260),
        status: o.status,
        meta: [
          stage,
          `${Number(o.probability) || 0}%`,
          value ? `£${Math.round(value).toLocaleString("en-GB")}` : "",
          nextAction ? owner : "",
        ].filter(Boolean).join(" · "),
        href: "/crm/revenue",
      });
    }

    for (const n of context || []) {
      items.push({
        id: `context:${n.id}`,
        type: "note",
        at: n.created_at,
        title: text(n.title || n.kind || "Note", 160),
        detail: text(n.content || n.url, 280),
        meta: text(n.kind, 40),
        href: n.url || undefined,
      });
    }

    if (company?.email_context && company?.email_context_updated_at) {
      items.push({
        id: "email:latest",
        type: "email",
        at: company.email_context_updated_at,
        title: "Latest email conversation added",
        detail: text(company.email_context, 320),
        meta: "feeds intent and prep",
      });
    }
    if (company?.notes && company?.updated_at) {
      items.push({
        id: "company:notes",
        type: "note",
        at: company.updated_at,
        title: "Client notes updated",
        detail: text(company.notes, 280),
        meta: "saved note",
      });
    }

    for (const u of upcoming || []) {
      items.push({
        id: `meeting:${u.id}`,
        type: "meeting",
        at: u.scheduled_at,
        title: text(u.title || "Upcoming call", 160),
        detail: text(u.intent, 260),
        status: u.prepped ? "prepared" : "prep needed",
        meta: u.prepped ? "prepared" : "prep needed",
        href: `/crm/prep?upcoming=${u.id}`,
        future: true,
      });
    }

    // Future meetings lead, soonest first. Past relationship history follows,
    // newest first. This avoids a recurring meeting months away hiding the
    // next call that actually needs attention.
    items.sort((a, b) => {
      if (!!a.future !== !!b.future) return a.future ? -1 : 1;
      const ams = new Date(a.at).getTime();
      const bms = new Date(b.at).getTime();
      return a.future ? ams - bms : bms - ams;
    });
    const counts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
    return NextResponse.json(
      { items: items.slice(0, 250), counts },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { items: [], error: err?.message || "failed to load timeline" },
      { status: 500 }
    );
  }
}
