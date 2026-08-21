import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { defaultOutlookQuestions } from "@/lib/opportunity-fields";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import { requireRequestScope } from "@/lib/request-scope";
import {
  activeSharedClientIds,
  loadSafeSharedCompanies,
} from "@/lib/team-client-sharing";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// GET /api/crm/opportunities -> all opportunities across clients, with company
// name. Powers the dashboard "opportunities" drill-down. ?status=open to filter.
export async function GET(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const status = req.nextUrl.searchParams.get("status");
    const nowMs = Date.now();
    const [{ data: ownedCompanies }, oppRes, { data: calls }, { data: upcoming }, sharedIds] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("id, name, profile")
        .eq("owner_id", scope.userId),
      (async () => {
        let q = supabaseAdmin
          .from("opportunities")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300);
        if (status) q = q.eq("status", status);
        return q;
      })(),
      supabaseAdmin
        .from("interview_summaries")
        .select("company_id, created_at")
        .eq("owner_id", scope.userId)
        .not("company_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("upcoming_calls")
        .select("company_id, title, scheduled_at")
        .eq("owner_id", scope.userId)
        .not("company_id", "is", null)
        .is("completed_at", null)
        .gte("scheduled_at", new Date(nowMs).toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(500),
      activeSharedClientIds(),
    ]);
    const ownedIds = new Set((ownedCompanies || []).map((company: any) => company.id));
    const sharedCompanies = await loadSafeSharedCompanies(
      sharedIds.filter((id) => !ownedIds.has(id)),
      scope.workspaceId
    );
    const companies = [...(ownedCompanies || []), ...sharedCompanies];
    const nameById = new Map<string, string>();
    const lastTouchById = new Map<string, number>();
    const nextMeetingById = new Map<string, string>();
    for (const c of companies || []) {
      nameById.set(c.id, c.name);
      const emailAt = (c.profile as any)?.email_last_message_at;
      const ms = emailAt ? new Date(emailAt).getTime() : NaN;
      if (Number.isFinite(ms)) lastTouchById.set(c.id, ms);
    }
    for (const call of calls || []) {
      const companyId = call.company_id as string;
      const ms = new Date(call.created_at as string).getTime();
      if (companyId && Number.isFinite(ms) && ms > (lastTouchById.get(companyId) || 0))
        lastTouchById.set(companyId, ms);
    }
    for (const meeting of upcoming || []) {
      if (!isPrepEligibleCalendarEvent(meeting)) continue;
      const companyId = meeting.company_id as string;
      if (companyId && !nextMeetingById.has(companyId))
        nextMeetingById.set(companyId, meeting.scheduled_at as string);
    }
    const items = (oppRes.data || []).map((o: any) => ({
      ...o,
      company: nameById.get(o.company_id) || "a client",
      ...(() => {
        const alerts: { code: string; label: string; priority: number }[] = [];
        const nextMeetingAt = nextMeetingById.get(o.company_id) || null;
        const storedActivity = o.last_meaningful_activity_at
          ? new Date(o.last_meaningful_activity_at).getTime()
          : 0;
        const touched = Math.max(lastTouchById.get(o.company_id) || 0, storedActivity || 0) || null;
        const daysQuiet = touched
          ? Math.max(0, Math.floor((nowMs - touched) / (24 * 60 * 60 * 1000)))
          : null;
        const plan = o.close_plan && typeof o.close_plan === "object" ? o.close_plan : {};
        const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
        const overdue = milestones.filter((m: any) => {
          if (m?.status === "done" || typeof m?.dueAt !== "string") return false;
          const due = new Date(`${m.dueAt}T23:59:59`).getTime();
          return Number.isFinite(due) && due < nowMs;
        });
        if (overdue.length)
          alerts.push({
            code: "milestone_overdue",
            label: `${overdue.length} close-plan milestone${overdue.length === 1 ? "" : "s"} overdue`,
            priority: 1,
          });
        if (typeof plan.targetCloseDate === "string") {
          const target = new Date(`${plan.targetCloseDate}T23:59:59`).getTime();
          if (Number.isFinite(target) && target < nowMs)
            alerts.push({ code: "decision_passed", label: "Target decision date has passed", priority: 1 });
        }
        if (!nextMeetingAt)
          alerts.push({ code: "no_next_meeting", label: "No next meeting booked", priority: 2 });
        if (daysQuiet != null && daysQuiet >= 7 && !nextMeetingAt)
          alerts.push({ code: "quiet", label: `No recorded contact for ${daysQuiet} days`, priority: daysQuiet >= 14 ? 1 : 2 });
        const proposalSent = milestones.some(
          (m: any) => m?.status === "done" && /proposal|commercial/i.test(String(m?.label || ""))
        );
        if (proposalSent && !nextMeetingAt)
          alerts.push({ code: "proposal_no_followup", label: "Proposal sent without a follow-up meeting", priority: 1 });
        alerts.sort((a, b) => a.priority - b.priority);
        return {
          alerts,
          daysQuiet,
          nextMeetingAt,
          lastMeaningfulActivityAt: touched ? new Date(touched).toISOString() : null,
          outlookQuestions:
            Array.isArray(o.win_outlook_questions) && o.win_outlook_questions.length
              ? o.win_outlook_questions
              : defaultOutlookQuestions(o),
        };
      })(),
    }));
    return NextResponse.json({ opportunities: items });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load opportunities" },
      { status: 500 }
    );
  }
}
