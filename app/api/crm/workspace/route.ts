import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/crm/workspace -> the global knowledge base ("brain").
export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("knowledge, updated_at")
      .eq("id", "main")
      .maybeSingle();
    return NextResponse.json({
      knowledge: data?.knowledge || "",
      updatedAt: data?.updated_at || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load workspace" },
      { status: 500 }
    );
  }
}

// PUT /api/crm/workspace -> save the knowledge base (upsert the single row).
export async function PUT(req: NextRequest) {
  try {
    const { knowledge } = await req.json();
    const { error } = await supabaseAdmin.from("workspace_profile").upsert(
      {
        id: "main",
        knowledge: typeof knowledge === "string" ? knowledge : "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save workspace" },
      { status: 500 }
    );
  }
}
