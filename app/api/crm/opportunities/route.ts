import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/crm/opportunities -> all opportunities across clients, with company
// name. Powers the dashboard "opportunities" drill-down. ?status=open to filter.
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status");
    const [{ data: companies }, oppRes] = await Promise.all([
      supabaseAdmin.from("companies").select("id, name"),
      (async () => {
        let q = supabaseAdmin
          .from("opportunities")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300);
        if (status) q = q.eq("status", status);
        return q;
      })(),
    ]);
    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);
    const items = (oppRes.data || []).map((o: any) => ({
      ...o,
      company: nameById.get(o.company_id) || "a client",
    }));
    return NextResponse.json({ opportunities: items });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load opportunities" },
      { status: 500 }
    );
  }
}
