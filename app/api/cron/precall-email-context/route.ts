import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import { setAppConfigValue } from "@/lib/app-config";
import { resolveRecordScope } from "@/lib/record-scope";
import { listActiveAccountScopes } from "@/lib/automation-accounts";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { POST as pullEmailContext } from "@/app/api/crm/email-pull/route";
import { POST as buildPrepIntent } from "@/app/api/crm/companies/[id]/prep-intent/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HOUR = 60 * 60 * 1000;
const LOOK_AHEAD_HOURS = 72;
const MAX_COMPANIES_PER_RUN = 6;
const CONCURRENCY = 2;

const scheduledRefreshWindow = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const weekend = weekday === "Saturday" || weekday === "Sunday";
  return weekend ? hour === 10 : [9, 12, 15, 18, 21].includes(hour);
};

type UpcomingCall = {
  id: string;
  company_id: string;
  workstream_id: string | null;
  title: string | null;
  scheduled_at: string;
  attendees: Record<string, any>[] | null;
  prep: Record<string, any> | null;
};

type CompanyGroup = {
  companyId: string;
  calls: UpcomingCall[];
  earliestAt: number;
  oldestCheckAt: number;
};

const validMs = (value: unknown): number => {
  if (typeof value !== "string") return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

// Calls are checked more often as they get closer. Opening Prep still performs
// an immediate final check, so a last-minute email cannot be missed.
const minimumCheckGap = (scheduledAt: string, nowMs: number) => {
  const hoursUntil = Math.max(0, (validMs(scheduledAt) - nowMs) / HOUR);
  if (hoursUntil <= 8) return 90 * 60 * 1000;
  if (hoursUntil <= 24) return 4 * HOUR;
  return 12 * HOUR;
};

const lastCheckAt = (call: UpcomingCall) =>
  validMs(call.prep?.emailContextSync?.checkedAt);

async function runAccount(req: NextRequest) {
  try {
    await resolveRecordScope();
    const startedAt = new Date();
    const nowMs = startedAt.getTime();
    const horizon = new Date(nowMs + LOOK_AHEAD_HOURS * HOUR).toISOString();
    const { data: rows, error: callsError } = await supabaseAdmin
      .from("upcoming_calls")
      .select("id,company_id,workstream_id,title,scheduled_at,attendees,prep")
      .is("completed_at", null)
      .not("company_id", "is", null)
      .gte("scheduled_at", startedAt.toISOString())
      .lte("scheduled_at", horizon)
      .order("scheduled_at", { ascending: true })
      .limit(40);
    if (callsError) throw callsError;

    const calls = ((rows || []) as UpcomingCall[]).filter((call) =>
      isPrepEligibleCalendarEvent(call)
    );
    const companyIds = Array.from(new Set(calls.map((call) => call.company_id)));
    const { data: companies, error: companiesError } = companyIds.length
      ? await supabaseAdmin.from("companies").select("id,stage").in("id", companyIds)
      : { data: [], error: null };
    if (companiesError) throw companiesError;
    const inHouse = new Set(
      (companies || [])
        .filter((company: any) => String(company.stage || "").trim().toLowerCase() === "in house")
        .map((company: any) => company.id as string)
    );

    const grouped = new Map<string, UpcomingCall[]>();
    for (const call of calls) {
      if (!call.company_id || inHouse.has(call.company_id)) continue;
      const list = grouped.get(call.company_id) || [];
      list.push(call);
      grouped.set(call.company_id, list);
    }

    const groups: CompanyGroup[] = [];
    for (const [companyId, companyCalls] of grouped) {
      const eligible = companyCalls.some((call) => {
        const checkedAt = lastCheckAt(call);
        return nowMs - checkedAt >= minimumCheckGap(call.scheduled_at, nowMs);
      });
      if (!eligible) continue;
      groups.push({
        companyId,
        calls: companyCalls,
        earliestAt: Math.min(...companyCalls.map((call) => validMs(call.scheduled_at))),
        oldestCheckAt: Math.min(...companyCalls.map((call) => lastCheckAt(call))),
      });
    }
    groups.sort(
      (a, b) => a.oldestCheckAt - b.oldestCheckAt || a.earliestAt - b.earliestAt
    );

    const selected = groups.slice(0, MAX_COMPANIES_PER_RUN);
    let checked = 0;
    let contextRefreshed = 0;
    let intentsRefreshed = 0;
    let unchanged = 0;
    let noMail = 0;
    let failed = 0;

    const processGroup = async (group: CompanyGroup) => {
      const sourceCall =
        group.calls.find(
          (call) =>
            nowMs - lastCheckAt(call) >=
            minimumCheckGap(call.scheduled_at, nowMs)
        ) || group.calls[0];
      const checkedAt = new Date().toISOString();
      let status = "error";
      let messages = 0;
      let changed = false;
      let errorText = "";

      try {
        const emailResponse = await pullEmailContext(new NextRequest(new URL("/api/crm/email-pull", req.url), {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: group.companyId,
            upcomingId: sourceCall.id,
            ...(sourceCall.workstream_id
              ? { workstreamId: sourceCall.workstream_id }
              : {}),
          }),
        }));
        const result = await emailResponse.json().catch(() => ({}));
        messages = Number(result?.messages) || 0;
        if (emailResponse.ok && result?.ok) {
          changed = result.cached !== true;
          status = changed ? "refreshed" : "current";
          if (changed) contextRefreshed += 1;
          else unchanged += 1;
        } else if (emailResponse.status === 404) {
          status = "no_mail";
          noMail += 1;
        } else {
          errorText = String(result?.error || `email check failed (${emailResponse.status})`).slice(0, 180);
          failed += 1;
        }
      } catch (error: any) {
        errorText = String(error?.message || "email check failed").slice(0, 180);
        failed += 1;
      }

      // Store a small operational marker on the scheduled call. This lets the
      // next cron skip work it has just done without introducing another table.
      await supabaseAdmin
        .from("upcoming_calls")
        .update({
          prep: {
            ...(sourceCall.prep && typeof sourceCall.prep === "object"
              ? sourceCall.prep
              : {}),
            emailContextSync: {
              checkedAt,
              status,
              messages,
              ...(errorText ? { error: errorText } : {}),
            },
          },
        })
        .eq("id", sourceCall.id);

      // A changed email summary invalidates the cached next-call intent. The
      // prep-intent endpoint regenerates it once per company, reuses that cache
      // for additional calls, and refuses to overwrite a manually edited intent.
      if (changed) {
        try {
          const intentResponse = await buildPrepIntent(
            new NextRequest(new URL(`/api/crm/companies/${group.companyId}/prep-intent`, req.url), {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ concise: true, upcomingId: sourceCall.id }),
            }),
            { params: { id: group.companyId } }
          );
          if (intentResponse.ok) intentsRefreshed += 1;
        } catch {
          // The email summary remains safely stored. Opening Prep retries the
          // intent pass immediately if this best-effort refresh times out.
        }
      }
      checked += 1;
    };

    for (let index = 0; index < selected.length; index += CONCURRENCY) {
      await Promise.all(selected.slice(index, index + CONCURRENCY).map(processGroup));
    }

    const report = {
      ok: true,
      checked,
      contextRefreshed,
      intentsRefreshed,
      unchanged,
      noMail,
      failed,
      skippedInHouse: calls.filter((call) => inHouse.has(call.company_id)).length,
      deferred: Math.max(0, groups.length - selected.length),
      horizonHours: LOOK_AHEAD_HOURS,
      finishedAt: new Date().toISOString(),
    };
    await setAppConfigValue({
      key: "precall_email_context_last_run",
      value: JSON.stringify(report),
      note: "Latest automatic pre-call email context refresh",
    });
    return NextResponse.json(report);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "pre-call email context refresh failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  if (!scheduledRefreshWindow()) {
    return NextResponse.json({
      ok: true,
      skipped: "Outside the London pre-call email refresh window",
    });
  }
  const accounts = await listActiveAccountScopes({ connectedOnly: true });
  const results = await Promise.all(accounts.map(async (account) => {
    const response = await runWithServiceRecordScope(account, () => runAccount(req));
    return { userId: account.userId, status: response.status, result: await response.json() };
  }));
  return NextResponse.json({
    ok: results.every((row) => row.status < 400),
    accounts: results,
  });
}
