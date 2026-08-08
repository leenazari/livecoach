import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of ["name", "goal", "audience", "offer_angle"]) if (typeof body[key] === "string" && body[key].trim()) patch[key] = body[key].trim();
    if (["draft", "active", "paused", "completed"].includes(body.status)) patch.status = body.status;
    if (body.daily_limit != null) patch.daily_limit = Math.min(20, Math.max(1, Number(body.daily_limit) || 20));
    // Approval mode is deliberately locked on for this first safe release.
    patch.approval_mode = true;
    if (patch.status === "active") {
      await supabaseAdmin.from("outreach_campaigns").update({ status: "paused", updated_at: new Date().toISOString() }).neq("id", params.id).eq("status", "active");
    }
    const { data, error } = await supabaseAdmin.from("outreach_campaigns").update(patch).eq("id", params.id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ campaign: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to update campaign" }, { status: 500 });
  }
}
