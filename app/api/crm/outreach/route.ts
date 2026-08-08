import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const priority = req.nextUrl.searchParams.get("priority") || "all";
    const status = req.nextUrl.searchParams.get("status") || "all";
    let query = supabaseAdmin
      .from("outreach_prospects")
      .select("*")
      .order("priority_score", { ascending: false })
      .order("company_name", { ascending: true })
      .limit(1000);
    if (["high", "medium", "low"].includes(priority)) query = query.eq("priority", priority);
    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ prospects: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed to load outreach prospects" }, { status: 500 });
  }
}
