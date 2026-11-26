import { NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveCallLead } from "@/lib/call-subject";
import { resolveWorkstreamFromAttendees } from "@/lib/workstreams";
import { isUuid } from "@/lib/uuid";

import { googleCalendarSeriesKey, googleCalendarSeriesPattern } from "@/lib/calendar-series-key";

export const dynamic = "force-dynamic";

function short(value: unknown, max = 145) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : normalized.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function reply(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  let scope;
  try {
    scope = requireRequestScope();
  } catch {
    return reply({ error: "Sign in to view your call brief." }, 401);
  }
  if (!isUuid(params.id)) return reply({ error: "Scheduled call not found." }, 404);
  try {
    const { data: call, error } = await supabaseAdmin.from("upcoming_calls")
      .select("id,company_id,workstream_id,title,attendees,prep,source,external_id,scheduled_at")
      .eq("id", params.id).eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId)
      .maybeSingle();
    if (error) throw error;
    if (!call) return reply({ error: "Scheduled call not found." }, 404);

    const lead = await resolveCallLead(call);
    const primary = lead.primaryAttendee;
    const workstream = call.company_id && primary?.email
      ? await resolveWorkstreamFromAttendees({ companyId: call.company_id, attendees: [primary] })
      : null;
    const verified = workstream && (!call.workstream_id || workstream.id === call.workstream_id)
      ? workstream : null;
    const brief = {
      attendees: lead.leadChoices.slice(0, 3).map(person => short(person.name, 45)),
      attendeeCount: lead.leadChoices.length,
      lastCall: null as { id: string; headline: string; at: string } | null,
      email: lead.meetingEmail ? { subject: short(lead.meetingEmail.subject, 90), context: short(lead.meetingEmail.context) } : null,
      promises: [] as { id: string; text: string; dueAt: string | null }[],
      gap: "",
      historyMatched: Boolean(verified),
    };

    const seriesKey = googleCalendarSeriesKey(call.source, call.external_id);
    if (seriesKey && call.scheduled_at) {
      const { workspaceId, userId } = scope;
      const { data: occurrences, error: occurrenceError } = await supabaseAdmin.from("upcoming_calls")
        .select("id,external_id,scheduled_at")
        .eq("workspace_id", workspaceId).eq("owner_id", userId).eq("source", "google")
        .like("external_id", googleCalendarSeriesPattern(seriesKey))
        .not("completed_at", "is", null).lt("scheduled_at", call.scheduled_at)
        .gte("scheduled_at", new Date(Date.now() - 60 * 86400000).toISOString())
        .order("scheduled_at", { ascending: false }).limit(24);
      if (occurrenceError) throw occurrenceError;
      const prior = (occurrences || []).filter(o => googleCalendarSeriesKey("google", o.external_id) === seriesKey);
      if (prior.length) {
        const { data: sessions, error: sessionError } = await supabaseAdmin.from("interview_sessions")
          .select("session_id,upcoming_id")
          .eq("workspace_id", workspaceId).eq("owner_id", userId)
          .in("upcoming_id", prior.map(o => o.id)).not("ended_at", "is", null)
          .order("ended_at", { ascending: false }).limit(48);
        if (sessionError) throw sessionError;
        const sessionIds = (sessions || []).map(row => row.session_id);
        if (sessionIds.length) {
          const [summaries, tasks] = await Promise.all([
            supabaseAdmin.from("interview_summaries").select("id,session_id,created_at,summary")
              .eq("workspace_id", workspaceId).eq("owner_id", userId)
              .in("session_id", sessionIds).order("created_at", { ascending: false }).limit(48),
            supabaseAdmin.from("tasks").select("id,text,due_at")
              .eq("workspace_id", workspaceId).eq("owner_id", userId).eq("status", "open")
              .in("source_ref", sessionIds).order("due_at", { ascending: true, nullsFirst: false })
              .order("created_at", { ascending: false }).limit(2),
          ]);
          if (summaries.error || tasks.error) throw new Error("Recurring call history unavailable");
          // Choose by occurrence date, so a newly recovered older summary can't
          // displace the most recent actual meeting.
          for (const occurrence of prior) {
            const ids = new Set((sessions || []).filter(row => row.upcoming_id === occurrence.id).map(row => row.session_id));
            const previous = (summaries.data || []).find(row => ids.has(row.session_id)
              && String(row.summary?.recommendation || "").toLowerCase() !== "incomplete"
              && short(row.summary?.headline || row.summary?.title));
            if (!previous) continue;
            const headline = short(previous.summary?.headline || previous.summary?.title);
            const gaps = previous.summary?.notCovered;
            return reply({
              ...brief,
              historyMatched: true,
              lastCall: { id: previous.id, headline, at: occurrence.scheduled_at },
              promises: (tasks.data || []).map(task => ({ id: task.id, text: short(task.text, 75), dueAt: task.due_at })).filter(task => task.text),
              gap: Array.isArray(gaps) ? gaps.map(item => short(item, 90)).find(Boolean) || "" : "",
              seriesHistory: true,
            });
          }
        }
      }
    }

    if (verified) {
      const { workspaceId, userId } = scope;
      const [summary, tasks, mail] = await Promise.all([
        supabaseAdmin.from("interview_summaries").select("id,created_at,summary")
          .eq("workspace_id", workspaceId).eq("owner_id", userId)
          .eq("company_id", verified.companyId).eq("workstream_id", verified.id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("tasks").select("id,text,due_at")
          .eq("workspace_id", workspaceId).eq("owner_id", userId)
          .eq("company_id", verified.companyId).eq("workstream_id", verified.id).eq("status", "open")
          .order("due_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(2),
        brief.email ? Promise.resolve({ data: null, error: null }) :
          supabaseAdmin.from("workstreams").select("email_context,email_context_meta")
            .eq("workspace_id", workspaceId).eq("owner_id", userId).eq("id", verified.id).maybeSingle(),
      ]);
      if (summary.error || tasks.error || mail.error) throw new Error("Call brief history unavailable");
      const headline = short(summary.data?.summary?.headline || summary.data?.summary?.title);
      if (headline && summary.data) brief.lastCall = { id: summary.data.id, headline, at: summary.data.created_at };
      const gaps = summary.data?.summary?.notCovered;
      if (Array.isArray(gaps)) brief.gap = gaps.map(item => short(item, 90)).find(Boolean) || "";
      brief.promises = (tasks.data || []).map(task => ({ id: task.id, text: short(task.text, 75), dueAt: task.due_at })).filter(task => task.text);
      if (mail.data?.email_context_meta?.email_context_counterparty_email === primary?.email && short(mail.data?.email_context)) {
        brief.email = { subject: "Recent email", context: short(mail.data?.email_context) };
      }
    }
    return reply(brief);
  } catch {
    return reply({ error: "Couldn’t load the call brief. You can still start the call." }, 500);
  }
}
