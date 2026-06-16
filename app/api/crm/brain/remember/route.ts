import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// POST /api/crm/brain/remember { note } -> save a durable preference, habit,
// standard practice or fact the user confirmed, into the brain's learned layer
// so it shapes future plans, cues and chats. Confirmed by the user first (the
// assistant proposes it as a confirm-gated action), so this just appends.
export async function POST(req: NextRequest) {
  try {
    const { note } = await req.json();
    const n = typeof note === "string" ? note.trim() : "";
    if (!n) return NextResponse.json({ error: "nothing to remember" }, { status: 400 });

    const { data } = await supabaseAdmin
      .from("workspace_profile")
      .select("learned")
      .eq("id", "main")
      .maybeSingle();
    const prev = data && typeof data.learned === "string" ? data.learned.trim() : "";

    // Skip if essentially already there (cheap dedupe on the normalised text).
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (prev && norm(prev).includes(norm(n))) {
      return NextResponse.json({ ok: true, alreadyKnown: true });
    }

    let next = prev ? `${prev}\n- ${n}` : `- ${n}`;
    if (next.length > 8000) next = next.slice(-8000);
    await supabaseAdmin
      .from("workspace_profile")
      .update({ learned: next })
      .eq("id", "main");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to remember" },
      { status: 500 }
    );
  }
}
