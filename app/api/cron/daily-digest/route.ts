import { NextRequest, NextResponse } from "next/server";
import { publicAppOrigin } from "@/lib/public-app-url";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { sendConnectedMail } from "@/lib/mail";
import { GET as getDashboard } from "@/app/api/crm/dashboard/route";
import { capitaliseSentenceStarts } from "@/lib/text";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import { POST as runCalendarSync } from "@/app/api/crm/calendar-sync/route";
import { getAppConfigValue, setAppConfigValue } from "@/lib/app-config";

export const runtime = "nodejs";
export const maxDuration = 120;
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

const compactSentences = (
  value: unknown,
  sentenceLimit = 2,
  max = 320
): string => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const selected = matches.slice(0, sentenceLimit).join(" ").trim();
  const shortened = selected.length <= max
    ? selected
    : `${selected.slice(0, max).replace(/\s+\S*$/, "").trim()}…`;
  return capitaliseSentenceStarts(shortened);
};

const firstListItem = (...values: unknown[]): string => {
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    const item = value.find(
      (entry) => typeof entry === "string" && entry.trim()
    );
    if (item) return compactSentences(item, 1, 220);
  }
  return "";
};

const listItems = (value: unknown, limit = 2): string[] =>
  (Array.isArray(value) ? value : [])
    .filter((entry) => typeof entry === "string" && entry.trim())
    .slice(0, limit)
    .map((entry) => compactSentences(entry, 1, 240));

const uniqueDetails = (...groups: string[][]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of groups.flat()) {
    const clean = String(item || "").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
};

const detailList = (items: { label: string; text: string }[]) =>
  `<ul style="margin:7px 0 0;padding:0 0 0 18px;">${items
    .filter((item) => item.text)
    .map(
      (item) =>
        `<li style="margin:0 0 5px;font-size:13px;line-height:1.45;color:#514c44;"><strong>${esc(item.label)}:</strong> ${esc(capitaliseSentenceStarts(item.text))}</li>`
    )
    .join("")}</ul>`;

const list = (items: string[], empty: string) =>
  items.length
    ? `<ul style="margin:0;padding:0 0 0 19px;">${items
        .map(
          (item) =>
            `<li style="margin:0 0 7px;font-size:14px;line-height:1.5;color:#403c35;">${item}</li>`
        )
        .join("")}</ul>`
    : `<p style="margin:0;font-size:14px;color:#858078;">${esc(empty)}</p>`;

async function runDigest(req: NextRequest) {
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
    const sentConfig = await getAppConfigValue(SENT_KEY);
    if (!force && sentConfig?.value === today) {
      return NextResponse.json({ ok: true, skipped: "already sent today" });
    }

    // The email must be built from calendar truth at send time. A separate
    // scheduled sync can race this cron or be hours old after a late invite
    // edit, so reconcile first and refuse to send a confidently stale brief.
    const syncResponse = await runCalendarSync();
    const syncResult = await syncResponse.json().catch(() => ({}));
    if (
      !syncResponse.ok ||
      syncResult?.ok !== true ||
      syncResult?.reconciled !== true
    ) {
      throw new Error(
        syncResult?.error ||
          "The connected calendar could not be completely reconciled before the brief"
      );
    }

    const since = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const horizon = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString();
    const appUrl = publicAppOrigin();
    // Use the dashboard's own deterministic ranking for the email too. Calling
    // the light route keeps it model-free while guaranteeing that the first
    // five priorities in both places are the same at send time.
    const dashboardPromise = getDashboard(
      new Request(`${appUrl}/api/crm/dashboard?light=1`)
    );
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
        .select("id, company_id, title, value, created_at, pipeline_stage, probability, next_action, next_action_due_at, next_action_owner, opportunity_type")
        .eq("status", "open")
        .eq("opportunity_type", "revenue")
        .order("value", { ascending: false })
        .limit(200),
    ]);
    for (const result of [callsRes, completedRes, openRes, upcomingRes, oppsRes]) {
      if (result.error) throw result.error;
    }
    const dashboardResponse = await dashboardPromise;
    const dashboardData = dashboardResponse.ok
      ? await dashboardResponse.json()
      : null;

    const calls = (callsRes.data || []).filter(
      (row: any) => row.created_at && dayKey(new Date(row.created_at)) === today
    );
    const completed = (completedRes.data || []).filter(
      (row: any) => row.done_at && dayKey(new Date(row.done_at)) === today
    );
    const prepEligibleCalls = (upcomingRes.data || []).filter(
      (row: any) => isPrepEligibleCalendarEvent(row)
    );
    const tomorrowCalls = prepEligibleCalls.filter(
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
    const companyDetails = new Map<string, any>();
    if (companyIds.length) {
      const { data, error } = await supabaseAdmin
        .from("companies")
        .select("id, name, stage, profile, commercial_memory")
        .in("id", companyIds);
      if (error) throw error;
      for (const company of data || []) {
        companyNames.set(company.id, company.name || "");
        companyDetails.set(company.id, company);
      }
    }

    // A one-word model verdict such as "Warm" or "Mixed" is not a progress
    // update. Lead with the factual outcome, then show what changed, the next
    // move and the biggest unresolved risk. This is deterministic and adds no
    // model cost to the daily email.
    const progress: string[] = [];
    for (const call of calls.slice(0, 6)) {
      const summary = call.summary && typeof call.summary === "object" ? call.summary : {};
      const label = companyNames.get(call.company_id) || call.candidate || call.role || "Call";
      const outcome = compactSentences(
        summary.headline || summary.overview || summary.summary,
        2,
        380
      );
      const change = firstListItem(
        summary.decisions,
        summary.buyingSignals,
        summary.strengths
      );
      const nextMove = firstListItem(
        summary.myNextActions,
        summary.suggestedNextActions
      );
      const watch = firstListItem(summary.concerns, summary.notCovered);
      const callLabel = call.company_id
        ? `<a href="${esc(`${appUrl}/crm/${call.company_id}`)}" style="color:#1c1b19;text-decoration:none;"><strong>${esc(label)}</strong></a>`
        : `<strong>${esc(label)}</strong>`;
      progress.push(`${callLabel}${detailList([
        { label: "Outcome", text: outcome || "Call completed and captured." },
        { label: "Progress made", text: change },
        { label: "Next move", text: nextMove },
        { label: "Watch", text: watch },
      ])}`);
    }
    for (const task of completed.slice(0, Math.max(0, 8 - progress.length))) {
      const company = companyNames.get(task.company_id);
      progress.push(`<strong>Completed:</strong> ${esc(capitaliseSentenceStarts(task.text))}${company ? ` <span style="color:#858078;">(${esc(company)})</span>` : ""}`);
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
    const dashboardActions = Array.isArray(dashboardData?.today?.topActions)
      ? dashboardData.today.topActions
      : [];
    const attentionRows = dashboardActions.length
      ? dashboardActions.slice(0, 5)
      : scoredTasks.slice(0, 5).map((task: any) => ({
          ...task,
          company: companyNames.get(task.company_id),
          href: task.company_id ? `/crm/${task.company_id}` : "/crm/board?tab=tasks",
        }));
    const attention = attentionRows.map((item: any) => {
      const colour = /overdue/i.test(String(item.reason || ""))
        ? "#a34b35"
        : "#9a7b12";
      const href = String(item.href || "/crm");
      return `<a href="${esc(`${appUrl}${href}`)}" style="color:inherit;text-decoration:none;"><strong style="color:${colour};">${esc(capitaliseSentenceStarts(item.reason || "Priority"))}</strong><br>${esc(capitaliseSentenceStarts(item.text))}${item.company ? ` <span style="color:#858078;">(${esc(item.company)})</span>` : ""}</a>`;
    });

    const tomorrowItems = tomorrowCalls.map((call: any) => {
      const time = new Intl.DateTimeFormat("en-GB", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(call.scheduled_at));
      const company = companyNames.get(call.company_id);
      const details = companyDetails.get(call.company_id) || {};
      const memory = details.commercial_memory && typeof details.commercial_memory === "object"
        ? details.commercial_memory
        : {};
      const intent = compactSentences(call.intent, 2, 340);
      const latestCall = memory.lastCall && typeof memory.lastCall === "object"
        ? memory.lastCall
        : {};
      const activity = memory.latestActivity && typeof memory.latestActivity === "object"
        ? memory.latestActivity
        : {};
      const relationship = compactSentences(
        activity.overview ||
          [latestCall.headline, latestCall.overview].filter(Boolean).join(": ") ||
          memory.email?.summary ||
          memory.relationship,
        1,
        260
      );
      const openLoop =
        compactSentences(activity.nextAction || memory.opportunity?.nextAction, 1, 220) ||
        firstListItem(
          latestCall.theirActions,
          latestCall.ourActions,
          latestCall.gaps
        );
      const prep = call.prepped
        ? "Ready — focus and plan are saved; review them before joining."
        : "Needs preparation — build the focus and plan before the call.";
      const prepHref = `${appUrl}/crm/prep?upcoming=${encodeURIComponent(call.id)}`;
      return `<a href="${esc(prepHref)}" style="color:#1c1b19;text-decoration:none;"><strong>${esc(time)} · ${esc(call.title || company || "Call")}</strong>${company && call.title !== company ? ` <span style="color:#858078;">(${esc(company)})</span>` : ""}</a>${detailList([
        { label: "Purpose", text: intent || "No call intent is saved yet." },
        { label: "Relationship context", text: relationship },
        { label: "Open loop", text: openLoop },
        { label: "Prep", text: prep },
      ])}`;
    });

    const buyingOpportunities = tomorrowCalls
      // A call is commercial only when the CRM has a genuine open revenue
      // opportunity. Intent wording alone is not evidence that someone is a
      // buyer, so partners, suppliers and internal meetings are excluded.
      .filter((call: any) => bestOpportunity.has(call.company_id))
      .slice(0, 6)
      .map((call: any) => {
        const company = companyNames.get(call.company_id) || call.title || "Call";
        const opportunity = bestOpportunity.get(call.company_id);
        const details = companyDetails.get(call.company_id) || {};
        const memory = details.commercial_memory && typeof details.commercial_memory === "object"
          ? details.commercial_memory
          : {};
        const latestCall = memory.lastCall && typeof memory.lastCall === "object"
          ? memory.lastCall
          : {};
        const activity = memory.latestActivity && typeof memory.latestActivity === "object"
          ? memory.latestActivity
          : {};
        const value = Number(opportunity?.value) || 0;
        const probability = Number(opportunity?.probability) || 0;
        const deal = [
          opportunity?.title,
          opportunity?.pipeline_stage
            ? `CRM stage: ${String(opportunity.pipeline_stage).replace(/_/g, " ")}`
            : "",
          probability ? `${probability}% close probability` : "",
          value ? `£${value.toLocaleString("en-GB")} potential value` : "",
        ].filter(Boolean).join(" · ");
        const evidenceItems = uniqueDetails(
          listItems(activity.buyingSignals),
          listItems(latestCall.buyingSignals),
          listItems(latestCall.commercialOpportunities),
          listItems(latestCall.decisions),
          memory.email?.summary
            ? [compactSentences(memory.email.summary, 1, 260)]
            : [],
          memory.relationship
            ? [compactSentences(memory.relationship, 2, 340)]
            : []
        ).slice(0, 2);
        const evidence = evidenceItems.length
          ? evidenceItems.join(" ")
          : "No specific buying evidence has been saved yet.";
        const gap =
          firstListItem(
            latestCall.objections,
            latestCall.gaps,
            activity.risks
          ) || "Confirm the real buyer, urgency, decision route and success criteria.";
        const nextMove =
          compactSentences(opportunity?.next_action, 1, 240) ||
          compactSentences(activity.nextAction, 1, 240) ||
          firstListItem(
            latestCall.ourActions,
            memory.openActions?.map((item: any) => item?.text)
          ) ||
          "Agree one dated decision step with the buyer.";
        return `<strong>${esc(company)}</strong>${detailList([
          { label: "Position", text: deal || "Open revenue opportunity" },
          { label: "Why it can close", text: evidence },
          { label: "Remaining risk", text: gap },
          { label: "Next commercial move", text: nextMove },
        ])}`;
      });

    const isSunday = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      weekday: "long",
    }).format(now) === "Sunday";
    const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const weekAhead = isSunday
      ? weekDays.map((weekday) => {
          const dayCalls = prepEligibleCalls.filter(
            (call: any) =>
              new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "long" }).format(new Date(call.scheduled_at)) === weekday
          );
          const items = dayCalls.map((call: any) => {
            const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(call.scheduled_at));
            const company = companyNames.get(call.company_id);
            const opportunity = bestOpportunity.get(call.company_id);
            const value = Number(opportunity?.value) || 0;
            return `<strong>${esc(time)} ${esc(call.title || company || "Call")}</strong>${call.prepped ? " · Prep ready" : " · <span style=\"color:#a34b35;\">Prep needed</span>"}${value ? ` · £${value.toLocaleString("en-GB")} opportunity` : ""}`;
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
    const dashboardUrl = `${appUrl}/crm`;
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
      openCount: Number(dashboardData?.kpis?.tasks) || openTasks.length,
      overdueCount: openTasks.filter((task: any) => {
        const due = task.due_at ? new Date(task.due_at).getTime() : NaN;
        return Number.isFinite(due) && due < nowMs;
      }).length,
      dashboardUrl,
    });

    const sent = await sendConnectedMail({
      to: RECIPIENT,
      subject: isSunday
        ? `LiveCoach week ahead: ${when}`
        : `LiveCoach daily brief: ${when}`,
      html,
    });
    if (!sent.ok) throw new Error(sent.error || "email send failed");

    await setAppConfigValue({
        key: SENT_KEY,
        value: today,
        note: "London date of the last successful daily progress email",
      });

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

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  const owners = await listActiveAccountScopes({ ownersOnly: true, connectedOnly: true });
  if (owners.length !== 1)
    return NextResponse.json({ error: "A single active workspace owner is required for the founder digest" }, { status: 409 });
  return runWithServiceRecordScope(owners[0], () => runDigest(req));
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
    ${section("Your dashboard priorities", list(data.attention, "No open actions need attention."))}
    ${section("Tomorrow’s call briefs", list(data.tomorrowItems, "No calls are currently scheduled for tomorrow."))}
    ${section("Tomorrow’s commercial opportunities", list(data.buyingOpportunities, "No genuine open revenue opportunity is attached to tomorrow’s calls."))}
    ${data.isSunday ? section("Monday to Friday", data.weekAhead.map((day) => `<div style="margin:0 0 15px;"><p style="margin:0 0 5px;font-size:14px;font-weight:700;">${esc(day.weekday)}</p>${list(day.items, "No calls scheduled.")}</div>`).join("")) : ""}
    ${section("Today’s progress, decisions and next moves", list(data.progress, "No completed calls or checked-off tasks were captured today."))}
    <a href="${esc(data.dashboardUrl)}" style="display:inline-block;padding:10px 16px;border-radius:20px;background:#26372b;color:#fff;text-decoration:none;font-size:13px;">Open LiveCoach dashboard</a>
    <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8a857c;">This snapshot is built from saved CRM, task and calendar data. It uses no AI generation, so it adds no model-token cost.</p>
  </td></tr></table></td></tr></table></body></html>`;
}
