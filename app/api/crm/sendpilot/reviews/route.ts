import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!UUID.test(id) || body?.action !== "dismiss") {
      return NextResponse.json(
        { error: "Choose a valid SendPilot review item" },
        { status: 400, headers: noStore }
      );
    }
    const now = new Date().toISOString();
    const { data, error } = await supabaseService
      .from("sendpilot_lead_reviews")
      .update({
        status: "dismissed",
        resolution_note: "Dismissed by the assigned salesperson",
        resolved_at: now,
        updated_at: now,
      })
      .eq("id", id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("status", "pending")
      .select("id,status")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "That SendPilot review item is no longer open" },
        { status: 404, headers: noStore }
      );
    }
    return NextResponse.json({ ok: true, review: data }, { headers: noStore });
  } catch {
    return NextResponse.json(
      { error: "Could not update the SendPilot review" },
      { status: 500, headers: noStore }
    );
  }
}
