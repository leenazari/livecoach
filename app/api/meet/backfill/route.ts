// FIRST LINE MARKER (route): app/api/meet/backfill/route.ts  — exports GET, no JSX
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get("session");
  if (!session) {
    return NextResponse.json({ error: "session required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("meet_utterances")
    .select("speaker, role, text, ts")
    .eq("session_id", session)
    .order("created_at", { ascending: true })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ utterances: data || [] });
}
