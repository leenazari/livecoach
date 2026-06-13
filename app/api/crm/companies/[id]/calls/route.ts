import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/crm/companies/:id/calls -> past calls/scorecards for this company,
// newest first. Drives the company's call-history view (and, later, Phase 2's
// auto-attach of history into the next call's plan).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("interview_summaries")
      .select("id, session_id, candidate, role, summary, created_at")
      .eq("company_id", params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ calls: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load call history" },
      { status: 500 }
    );
  }
}
