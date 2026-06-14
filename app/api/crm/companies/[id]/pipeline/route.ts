import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/crm/companies/:id/pipeline -> AI-surfaced opportunities + follow-up
// drafts for this company (newest first). Powers the company page's pipeline.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [{ data: opportunities }, { data: followUps }] = await Promise.all([
      supabaseAdmin
        .from("opportunities")
        .select("*")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("follow_ups")
        .select("*")
        .eq("company_id", params.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    return NextResponse.json({
      opportunities: opportunities || [],
      followUps: followUps || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load pipeline" },
      { status: 500 }
    );
  }
}
