// FIRST LINE MARKER (route): app/api/meet/backfill/route.ts  — exports GET, no JSX
import { NextRequest, NextResponse } from "next/server";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { validMeetSessionId } from "@/lib/transcriber";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accountScope = await resolveRecordScope();
  const session = req.nextUrl.searchParams.get("session");
  if (!validMeetSessionId(session)) {
    return NextResponse.json(
      { error: "A valid LiveCoach session is required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("meet_utterances")
    .select("speaker, role, text, ts")
    .eq("workspace_id", accountScope.workspaceId)
    .eq("owner_id", accountScope.userId)
    .eq("session_id", session)
    .order("created_at", { ascending: true })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { utterances: data || [] },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
