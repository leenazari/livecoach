import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/crm/calls -> every recorded call (scorecard), newest first, with the
// linked company name. Powers the calls list (name / company / date / cost).
export async function GET() {
  try {
    const [{ data: companies }, { data: calls }] = await Promise.all([
      supabaseAdmin.from("companies").select("id, name"),
      supabaseAdmin
        .from("interview_summaries")
        .select("id, candidate, role, company_id, created_at, cost")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);
    const items = (calls || []).map((c: any) => ({
      id: c.id,
      candidate: c.candidate,
      role: c.role,
      company_id: c.company_id,
      company: c.company_id ? nameById.get(c.company_id) || null : null,
      created_at: c.created_at,
      cost: c.cost,
    }));
    return NextResponse.json({ calls: items });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load calls" },
      { status: 500 }
    );
  }
}
