import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

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
      .select("id, session_id, candidate, role, summary, created_at, cost")
      .eq("company_id", params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    // Explicit no-store as well as force-dynamic. Force-dynamic alone has not
    // been enough here before: a CDN or edge layer could still hand back a
    // snapshot, which is how a recovered call stayed missing from this client's
    // history while the row existed in the database the whole time.
    return NextResponse.json(
      { calls: data || [] },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load call history" },
      { status: 500 }
    );
  }
}
