import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Force a dynamic serverless function. The GET handler takes no request arg, so
// Next would otherwise STATICALLY optimise this route - and a static route only
// allows GET, making PUT fail at the edge with a 405 INVALID_REQUEST_METHOD
// (this is what blocked saving the brain). force-dynamic keeps it a real
// function that serves every exported method.
export const dynamic = "force-dynamic";

// GET /api/crm/workspace -> the global knowledge base ("brain").
export async function GET() {
  try {
    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("knowledge, objection_stances, updated_at")
      .eq("id", "main")
      .maybeSingle();
    return NextResponse.json({
      knowledge: data?.knowledge || "",
      objectionStances: data?.objection_stances || "",
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
    const body = await req.json();
    // Only touch the fields actually provided, so saving one does not wipe the
    // other (upsert sets only the columns present in the object).
    const patch: Record<string, any> = {
      id: "main",
      updated_at: new Date().toISOString(),
    };
    if (typeof body.knowledge === "string") patch.knowledge = body.knowledge;
    if (typeof body.objectionStances === "string")
      patch.objection_stances = body.objectionStances;
    const { error } = await supabaseAdmin
      .from("workspace_profile")
      .upsert(patch, { onConflict: "id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save workspace" },
      { status: 500 }
    );
  }
}
