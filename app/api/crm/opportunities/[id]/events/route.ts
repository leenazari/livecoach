import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("opportunity_events")
      .select("id,event_type,source_type,source_channel,rationale,changes,evidence,created_at")
      .eq("opportunity_id", params.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ events: data || [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not load opportunity history" },
      { status: 500 }
    );
  }
}
