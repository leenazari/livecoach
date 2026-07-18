import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// GET /api/crm/drafts -> all follow-up drafts across clients, with company name.
// Powers the dashboard "drafts" drill-down.
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status") || "draft";
    const [{ data: companies }, { data: drafts }] = await Promise.all([
      supabaseAdmin.from("companies").select("id, name"),
      supabaseAdmin
        .from("follow_ups")
        .select("*")
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);
    const items = (drafts || []).map((d: any) => ({
      ...d,
      company: nameById.get(d.company_id) || "a client",
    }));
    return NextResponse.json({ drafts: items });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load drafts" },
      { status: 500 }
    );
  }
}
