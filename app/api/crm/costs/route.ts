import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CostRow = {
  feature: string;
  source: "calls" | "ai" | "automation";
  week: string | number;
  month: string | number;
  total: string | number;
};

type Period = "today" | "week" | "month" | "all";

const londonDateKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

// Convert a London calendar date at 00:00 into the correct UTC instant. The
// small correction loop keeps the boundary exact through both GMT and BST,
// including the two daylight-saving clock-change days.
const londonMidnightUtc = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    );
    const shown = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    guess += target - shown;
  }
  return new Date(guess).toISOString();
};

const usageCategory = (kind: string) => {
  const value = String(kind || "").toLowerCase();
  if (value.startsWith("automation"))
    return { feature: "Automation", source: "automation" as const };
  if (/(intent|research|battlecard|prep)/.test(value))
    return { feature: "Preparation & intent", source: "ai" as const };
  if (/(summary|profile|commitment|extract|digest|cross-link|activity)/.test(value))
    return { feature: "Summaries & CRM sync", source: "ai" as const };
  if (/(coach|brain|lesson|assistant|correct)/.test(value))
    return { feature: "Brain & coaching", source: "ai" as const };
  if (/(opp|day-read|pipeline)/.test(value))
    return { feature: "CRM organisation", source: "ai" as const };
  return { feature: "Other AI", source: "ai" as const };
};

export async function GET() {
  try {
    const now = new Date();
    const today = londonDateKey(now);
    const [year, month, day] = today.split("-").map(Number);
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1))
      .toISOString()
      .slice(0, 10);
    const todayStart = londonMidnightUtc(today);
    const todayEnd = londonMidnightUtc(tomorrow);

    const [rollupRes, todayCallsRes, todayUsageRes] = await Promise.all([
      supabaseAdmin.rpc("crm_dashboard_cost_rollup"),
      supabaseAdmin
        .from("interview_summaries")
        .select("cost")
        .not("cost", "is", null)
        .gte("created_at", todayStart)
        .lt("created_at", todayEnd)
        .limit(1000),
      supabaseAdmin
        .from("usage_log")
        .select("kind, cost_gbp")
        .gte("created_at", todayStart)
        .lt("created_at", todayEnd)
        .limit(5000),
    ]);
    if (rollupRes.error) throw rollupRes.error;
    if (todayCallsRes.error) throw todayCallsRes.error;
    if (todayUsageRes.error) throw todayUsageRes.error;

    const todayByFeature = new Map<
      string,
      { feature: string; source: CostRow["source"]; today: number }
    >();
    const addToday = (
      feature: string,
      source: CostRow["source"],
      amount: number
    ) => {
      const key = `${source}:${feature}`;
      const current = todayByFeature.get(key);
      todayByFeature.set(key, {
        feature,
        source,
        today: (current?.today || 0) + (Number(amount) || 0),
      });
    };
    for (const row of todayCallsRes.data || [])
      addToday("Live calls & cues", "calls", Number(row.cost) || 0);
    for (const row of todayUsageRes.data || []) {
      const category = usageCategory(row.kind);
      addToday(category.feature, category.source, Number(row.cost_gbp) || 0);
    }

    const featuresByKey = new Map(
      ((rollupRes.data || []) as CostRow[])
      .map((row) => ({
        feature: row.feature,
        source: row.source,
        today: 0,
        week: Number(row.week) || 0,
        month: Number(row.month) || 0,
        all: Number(row.total) || 0,
      }))
      .map((row) => [`${row.source}:${row.feature}`, row])
    );
    for (const [key, row] of todayByFeature) {
      const existing = featuresByKey.get(key);
      if (existing) existing.today = row.today;
      else
        featuresByKey.set(key, {
          ...row,
          week: row.today,
          month: row.today,
          all: row.today,
        });
    }
    const features = [...featuresByKey.values()]
      .sort((a, b) => b.week - a.week);

    const sum = (period: Period) =>
      features.reduce((total, row) => total + row[period], 0);
    const bySource = (source: CostRow["source"], period: Period) =>
      features
        .filter((row) => row.source === source)
        .reduce((total, row) => total + row[period], 0);

    const weekday = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
    }).format(now);
    const dayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
    const weekStart = new Date(
      Date.UTC(year, month - 1, day - Math.max(0, dayIndex))
    ).toISOString().slice(0, 10);

    return NextResponse.json({
      generatedAt: now.toISOString(),
      totals: {
        today: sum("today"),
        week: sum("week"),
        month: sum("month"),
        all: sum("all"),
      },
      periods: {
        today: { start: todayStart, end: todayEnd },
        week: { start: weekStart, end: today },
        month: {
          start: `${year}-${String(month).padStart(2, "0")}-01`,
          end: today,
        },
      },
      sources: {
        calls: {
          today: bySource("calls", "today"),
          week: bySource("calls", "week"),
          month: bySource("calls", "month"),
          all: bySource("calls", "all"),
        },
        ai: {
          today: bySource("ai", "today"),
          week: bySource("ai", "week"),
          month: bySource("ai", "month"),
          all: bySource("ai", "all"),
        },
        automation: {
          today: bySource("automation", "today"),
          week: bySource("automation", "week"),
          month: bySource("automation", "month"),
          all: bySource("automation", "all"),
        },
      },
      features,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not load the cost analysis" },
      { status: 500 }
    );
  }
}
