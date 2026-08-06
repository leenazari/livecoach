import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

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
  | "meeting";

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
    const now = Date.now();
    const [
      { data: company },
      { data: calls },
      { data: tasks },
      { data: followUps },
      { data: opportunities },
      { data: context },
      { data: upcoming },
    ] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("notes, updated_at, email_context, email_context_updated_at")
        .eq("id", params.id)
        .maybeSingle(),
      supabaseAdmin
        .from("interview_summaries")
        .select("id, session_id, candidate, summary, created_at")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("tasks")
        .select("id, text, kind, status, created_at, done_at, due_at")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(150),
      supabaseAdmin
        .from("follow_ups")
        .select("id, draft_subject, status, created_at")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("opportunities")
        .select("id, title, detail, value, status, created_at")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(80),
      supabaseAdmin
        .from("client_context")
        .select("id, kind, title, url, content, created_at")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(80),
      supabaseAdmin
        .from("upcoming_calls")
        .select("id, title, scheduled_at, intent, prepped, completed_at")
        .eq("company_id", params.id)
        .is("completed_at", null)
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(20),
    ]);

    const items: TimelineItem[] = [];
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
      const commitment = t.kind === "commitment";
      const due = t.due_at ? new Date(t.due_at).getTime() : null;
      items.push({
        id: `task:${t.id}`,
        type: commitment ? "commitment" : "task",
        at: t.done_at || t.created_at,
        title: text(t.text, 180),
        status: t.status,
        meta:
          t.status === "done"
            ? "completed"
            : due && due < now
            ? "overdue"
            : due
            ? `due ${new Date(due).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short" })}`
            : undefined,
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
      items.push({
        id: `opp:${o.id}`,
        type: "opportunity",
        at: o.created_at,
        title: text(o.title || "Opportunity", 160),
        detail: text(o.detail, 260),
        status: o.status,
        meta: value ? `£${Math.round(value).toLocaleString("en-GB")}` : undefined,
        href: "/crm/board?tab=opportunities",
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
