import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const PRIORITIES = new Set(["high", "medium", "low"]);
const STATUSES = new Set(["imported", "queued", "ready", "contacted", "replied", "qualified", "not_interested", "suppressed"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const patch: Record<string, string> = {};
    if (typeof body.priority === "string" && PRIORITIES.has(body.priority)) patch.priority = body.priority;
    if (typeof body.status === "string" && STATUSES.has(body.status)) patch.status = body.status;
    if (!Object.keys(patch).length) return NextResponse.json({ error: "no valid change supplied" }, { status: 400 });
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from("outreach_prospects").update(patch).eq("id", params.id).select("*").single();
    if (error) throw error;
    return NextResponse.json({ prospect: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed to update prospect" }, { status: 500 });
  }
}
