import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendMail } from "@/lib/gmail";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RECIPIENT = "lee@ai13.com";
const TIME_ZONE = "Europe/London";
const SENT_KEY = "daily_progress_email_last_sent";

const esc = (value: unknown): string =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const dayKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const firstSentence = (value: unknown, max = 180): string => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text;
  return sentence.length <= max
    ? sentence
    : `${sentence.slice(0, max).replace(/\s+\S*$/, "").trim()}…`;
};

const list = (items: string[], empty: string) =>
  items.length
    ? `<ul style="margin:0;padding:0 0 0 19px;">${items
        .map(
          (item) =>
            `<li style="margin:0 0 7px;font-size:14px;line-height:1.5;color:#403c35;">${item}</li>`
        )
        .join("")}</ul>`
    : `<p style="margin:0;font-size:14px;color:#858078;">${esc(empty)}</p>`;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  try {
    const now = new Date();
    const today = dayKey(now);
    const tomorrow = dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const force = new URL(req.url).searchParams.get("force") === "1";

    // Vercel may retry a cron invocation. Store the London date after a
    // successful send so retries cannot produce a second copy of the email.
    const { data: sentConfig } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", SENT_KEY)
      .maybeSingle();
    if (!force && sentConfig?.value === today) {
      return NextResponse.json({ ok: true, skipped: "already sent today" });
    }

    const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const horizon = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString();
    const [callsRes, completedRes, openRes, upcomingRes, oppsRes] = await Promise.all([
      supabaseAdmin
        .from("interview_summaries")
        .select("ref, candidate, role, summary, created_at, company_id")
        .gte("created_at", since)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("tasks")
        .select("id, text, company_id, done_at")
        .eq("status", "done")
        .gte("done_at", since)
        .order("done_at", { ascending: true })
        .limit(100),
      supabaseAdmin
        .from("tasks")
        .select("id, text, company_id, kind, due_at, created_at")
        .eq("status", "open")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(200),
      supabaseAdmin
        .from("upcoming_calls")
        .select("id, title, company_id, scheduled_at, intent, prepped")
        .is("completed_at", null)
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", horizon)
        .order("scheduled_at", { ascending: true })
        .limit(100),
      supabaseAdmin
        .from("opportunities")
        .select("id, company_id, title, value, created_at")
        .eq("status", "open")
        .order("value", { ascending: false })
        .limit(200),
    ]);
    for (const result of [callsRes, completedRes, openRes, upcomingRes, oppsRes]) {
      if (result.error) throw result.error;
    }

    const calls = (callsRes.data || []).filter(
      (row: any) => row.created_at && dayKey(new Date(row.created_at)) === today
    );
    const completed = (completedRes.data || []).filter(
      (row: any) => row.done_at && dayKey(new Date(row.done_at)) === today
    );
    const tomorrowCalls = (upcomingRes.data || []).filter(
      (row: any) =>
        row.scheduled_at && dayKey(new Date(row.scheduled_at)) === tomorrow
    );

    const companyIds = Array.from(
      new Set(
        [...calls, ...completed, ...(openRes.data || []), ...tomorrowCalls, ...(oppsRes.data || [])]
          .map((row: any) => row.company_id)
          .filter(Boolean)
      )
    );
    const companyNames = new Map<string, string>();
    if (companyIds.length) {
      const { data, error } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .in("id", companyIds);
      if (error) throw error;
      for (const company of data || []) companyNames.set(company.id, company.name || "");
    }

    const progress: string[] = completed.slice(0, 8).map((task: any) => {
      const company = companyNames.get(task.company_id);
      return `${esc(task.text)}${company ? ` <span style="color:#858078;">(${esc(company)})</span>` : ""}`;
    });
    for (const call of calls.slice(0, Math.max(0, 8 - progress.length))) {
      const summary = call.summary && typeof call.summary === "object" ? call.summary : {};
      const outcome = firstSentence(summary.recommendation || summary.overview || summary.summary);
      const label = companyNames.get(call.company_id) || call.candidate || call.role || "Call";
      progress.push(`<strong>${esc(label)}</strong>${outcome ? `: ${esc(outcome)}` : ": call completed and captured"}`);
    }

    const openTasks = openRes.data || [];
    const opportunities = oppsRes.data || [];
    const bestOpportunity = new Map<string, any>();
    for (const opportunity of opportunities) {
      if (!opportunity.company_id || bestOpportunity.has(opportunity.company_id)) continue;
      bestOpportunity.set(opportunity.company_id, opportunity);
    }
    const nowMs = now.getTime();
    const tomorrowEnd = nowMs + 48 * 60 * 60 * 1000;
    const scoredTasks = openTasks
      .map((task: any) => {
        const due = task.due_at ? new Date(task.due_at).getTime() : NaN;
        const ageDays = Math.max(0, (nowMs - new Date(task.created_at).getTime()) / 86_400_000);
        const opportunity = bestOpportunity.get(task.company_id);
        const value = Number(opportunity?.value) || 0;
        let score = 0;
        let reason = "Open action";
        if (Number.isFinite(due) && due < nowMs) {
          score += 120;
          reason = "Overdue";
        } else if (Number.isFinite(due) && due <= tomorrowEnd) {
          score += 90;
          reason = "Due before tomorrow ends";
        } else if (Number.isFinite(due) && due <= nowMs + 7 * 86_400_000) {
          score += 55;
          reason = "Due this week";
        }
        if (task.kind === "commitment") {
          score += 35;
          if (reason === "Open action") reason = "Promise you made";
        }
        if (task.kind === "counterparty_commitment") score += 15;
        score += Math.min(30, value / 50_000);
        score += Math.min(20, ageDays / 2);
        return { ...task, score, reason, opportunity };
      })
      .sort((a: any, b: any) => b.score - a.score);
    const attentionRows = scoredTasks
      .slice(0, 8);
    const attention = attentionRows.map((task: any) => {
      const company = companyNames.get(task.company_id);
      const value = Number(task.opportunity?.value) || 0;
      return `<strong style="color:${task.reason === "Overdue" ? "#a34b35" : "#9a7b12"};">${esc(task.reason)}</strong>: ${esc(task.text)}${company ? ` (${esc(company)})` : ""}${value ? ` <span style="color:#718a76;">· £${value.toLocaleString("en-GB")} opportunity</span>` : ""}`;
    });

    const tomorrowItems = tomorrowCalls.map((call: any) => {
      const time = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(call.scheduled_at));
      const company = companyNames.get(call.company_id);
      const intent = firstSentence(call.intent);
      const prep = call.prepped ? "Prep ready" : "Prep still needed";
      return `<strong>${esc(time)} · ${esc(call.title || company || "Call")}</strong><br><span style="color:${call.prepped ? "#55785e" : "#a34b35"};">${prep}</span>${intent ? `, ${esc(intent)}` : ""}`;
    });

    const buyingPattern = /\b(buy|buyer|budget|proposal|price|pricing|commercial|contract|pilot|demo|decision|procurement|close|deal|opportunity|solution|need|fit|stakeholder)\b/i;
    const buyingOpportunities = tomorrowCalls
      .filter((call: any) => bestOpportunity.has(call.company_id) || buyingPattern.test(String(call.intent || "")))
      .slice(0, 6)
      .map((call: any) => {
        const company = companyNames.get(call.company_id) || call.title || "Call";
        const opportunity = bestOpportunity.get(call.company_id);
        const value = Number(opportunity?.value) || 0;
        const intent = firstSentence(call.intent, 220);
        return `<strong>${esc(company)}</strong>${value ? ` · £${value.toLocaleString("en-GB")}` : ""}<br>${intent ? esc(intent) : "Use the call to confirm buyer need, decision process and a concrete next commitment."}`;
      });

    const isSunday = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      weekday: "long",
    }).format(now) === "Sunday";
    const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const weekAhead = isSunday
      ? weekDays.map((weekday) => {
          const dayCalls = (upcomingRes.data || []).filter(
            (call: any) =>
              new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "long" }).format(new Date(call.scheduled_at)) === weekday
          );
          const items = dayCalls.map((call: any) => {
            const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(call.scheduled_at));
            const company = companyNames.get(call.company_id);
            const opportunity = bestOpportunity.get(call.company_id);
            const value = Number(opportunity?.value) || 0;
            return `<strong>${esc(time)} ${esc(call.title || company || "Call")}</strong>${call.prepped ? " · prep ready" : " · <span style=\"color:#a34b35;\">prep needed</span>"}${value ? ` · £${value.toLocaleString("en-GB")} opportunity` : ""}`;
          });
          return { weekday, items };
        })
      : [];

    const when = now.toLocaleDateString("en-GB", {
      timeZone: TIME_ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://livecoach-alpha.vercel.app"}/crm`;
    const html = renderEmail({
      when,
      callCount: calls.length,
      completedCount: completed.length,
      progress,
      attention,
      tomorrowItems,
      buyingOpportunities,
      weekAhead,
      isSunday,
      openCount: openTasks.length,
      overdueCount: scoredTasks.filter((task: any) => task.reason === "Overdue").length,
      dashboardUrl,
    });

    const sent = await sendMail({
      to: RECIPIENT,
      subject: isSunday
        ? `LiveCoach week ahead: ${when}`
        : `LiveCoach daily brief: ${when}`,
      html,
    });
    if (!sent.ok) throw new Error(sent.error || "email send failed");

    const { error: stampError } = await supabaseAdmin.from("app_config").upsert(
      {
        key: SENT_KEY,
        value: today,
        note: "London date of the last successful daily progress email",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (stampError) throw stampError;

    return NextResponse.json({
      ok: true,
      to: RECIPIENT,
      calls: calls.length,
      completed: completed.length,
      tomorrow: tomorrowCalls.length,
      attention: attention.length,
      buyingOpportunities: buyingOpportunities.length,
      weekly: isSunday,
    });
  } catch (error: any) {
    console.error("daily digest failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "daily digest failed" },
      { status: 500 }
    );
  }
}

function renderEmail(data: {
  when: string;
  callCount: number;
  completedCount: number;
  progress: string[];
  attention: string[];
  tomorrowItems: string[];
  buyingOpportunities: string[];
  weekAhead: { weekday: string; items: string[] }[];
  isSunday: boolean;
  openCount: number;
  overdueCount: number;
  dashboardUrl: string;
}): string {
  const section = (title: string, body: string) => `
    <div style="margin:0 0 24px;padding:0 0 22px;border-bottom:1px solid #ece9e3;">
      <h2 style="margin:0 0 11px;font-size:16px;color:#1c1b19;">${esc(title)}</h2>
      ${body}
    </div>`;
  return `<!doctype html><html><body style="margin:0;background:#f5f4f1;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;background:#f5f4f1;"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #e3e0da;border-radius:10px;"><tr><td style="padding:28px 30px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1c1b19;">
    <p style="margin:0 0 3px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#718a76;">LiveCoach</p>
    <h1 style="margin:0 0 6px;font-size:22px;">${data.isSunday ? "Your week-ahead brief" : "Your daily executive brief"}</h1>
    <p style="margin:0 0 25px;font-size:14px;color:#777168;">${esc(data.when)} · ${data.openCount} open actions · ${data.overdueCount} overdue · ${data.callCount} calls captured today</p>
    ${section("Your highest-priority moves", list(data.attention, "No open actions need attention."))}
    ${section("Tomorrow: prepare at a glance", list(data.tomorrowItems, "No calls are currently scheduled for tomorrow."))}
    ${section("Buying opportunities in tomorrow’s calls", list(data.buyingOpportunities, "No clear buying opportunity is attached to tomorrow’s calls yet."))}
    ${data.isSunday ? section("Monday to Friday", data.weekAhead.map((day) => `<div style="margin:0 0 15px;"><p style="margin:0 0 5px;font-size:14px;font-weight:700;">${esc(day.weekday)}</p>${list(day.items, "No calls scheduled.")}</div>`).join("")) : ""}
    ${section("Today’s progress", list(data.progress, "No completed calls or checked-off tasks were captured today."))}
    <a href="${esc(data.dashboardUrl)}" style="display:inline-block;padding:10px 16px;border-radius:20px;background:#26372b;color:#fff;text-decoration:none;font-size:13px;">Open LiveCoach dashboard</a>
    <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8a857c;">This snapshot is built from saved CRM, task and calendar data. It uses no AI generation, so it adds no model-token cost.</p>
  </td></tr></table></td></tr></table></body></html>`;
}
