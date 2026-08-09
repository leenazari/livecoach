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

const londonDateKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.rpc("crm_dashboard_cost_rollup");
    if (error) throw error;

    const rows = (data || []) as CostRow[];
    const features = rows
      .map((row) => ({
        feature: row.feature,
        source: row.source,
        week: Number(row.week) || 0,
        month: Number(row.month) || 0,
        all: Number(row.total) || 0,
      }))
      .sort((a, b) => b.week - a.week);

    const sum = (period: "week" | "month" | "all") =>
      features.reduce((total, row) => total + row[period], 0);
    const bySource = (source: CostRow["source"], period: "week" | "month" | "all") =>
      features
        .filter((row) => row.source === source)
        .reduce((total, row) => total + row[period], 0);

    const now = new Date();
    const today = londonDateKey(now);
    const [year, month, day] = today.split("-").map(Number);
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
        week: sum("week"),
        month: sum("month"),
        all: sum("all"),
      },
      periods: {
        week: { start: weekStart, end: today },
        month: {
          start: `${year}-${String(month).padStart(2, "0")}-01`,
          end: today,
        },
      },
      sources: {
        calls: {
          week: bySource("calls", "week"),
          month: bySource("calls", "month"),
          all: bySource("calls", "all"),
        },
        ai: {
          week: bySource("ai", "week"),
          month: bySource("ai", "month"),
          all: bySource("ai", "all"),
        },
        automation: {
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
