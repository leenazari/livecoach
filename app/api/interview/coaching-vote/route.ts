import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Mutating route, so it must be dynamic (the static-route lesson).
export const dynamic = "force-dynamic";

// Up/down vote a speaking-coaching point. The vote feeds getCoachingTasteBlock,
// so future debriefs lean toward the kind of coaching the host finds useful.
// Pass vote 1 (useful), -1 (not), or 0 (clear).
export async function POST(req: NextRequest) {
  try {
    const { id, vote } = await req.json();
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const v = vote === 1 || vote === -1 ? vote : 0;
    const { error } = await supabaseAdmin
      .from("coaching_points")
      .update({ vote: v })
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true, vote: v });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "vote failed" },
      { status: 500 }
    );
  }
}
