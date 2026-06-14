import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/crm/tasks[?companyId=] -> the live to-do list: every OPEN task plus
// tasks completed TODAY (so a ticked task lingers for the rest of the day then
// drops off on its own). Newest-relevant first. Joins the company name.
export async function GET(req: NextRequest) {
  try {
    const companyId = new URL(req.url).searchParams.get("companyId");

    // Start of today (server local) - done tasks older than this are hidden.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let q = supabaseAdmin
      .from("tasks")
      .select(
        "id, company_id, text, kind, link_kind, status, done_at, created_at"
      )
      .order("created_at", { ascending: true })
      .limit(500);
    if (companyId) q = q.eq("company_id", companyId);

    const [{ data: rows }, { data: companies }] = await Promise.all([
      q,
      supabaseAdmin.from("companies").select("id, name"),
    ]);

    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);

    const startMs = startOfToday.getTime();
    const tasks = (rows || [])
      .filter((t: any) => {
        if (t.status !== "done") return true;
        // keep done tasks only if completed today
        return t.done_at && new Date(t.done_at).getTime() >= startMs;
      })
      .map((t: any) => ({
        ...t,
        company: t.company_id ? nameById.get(t.company_id) || null : null,
      }))
      // open first, then done; within each, oldest first
      .sort((a: any, b: any) => {
        if (a.status !== b.status) return a.status === "done" ? 1 : -1;
        return 0;
      });

    return NextResponse.json({ tasks });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load tasks" },
      { status: 500 }
    );
  }
}
