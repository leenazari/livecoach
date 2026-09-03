// FIRST LINE MARKER (route): app/api/meet/backfill/route.ts  — exports GET, no JSX
import { NextRequest, NextResponse } from "next/server";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";
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

  // A subscriber can read the canonical capture only through this route. The
  // raw transcript remains private under the capture owner and is never made a
  // team-visible database row.
  const { data: subscription, error: subscriptionError } = await supabaseService
    .from("meet_capture_subscribers")
    .select("capture_id")
    .eq("workspace_id", accountScope.workspaceId)
    .eq("owner_id", accountScope.userId)
    .eq("session_id", session)
    .maybeSingle();
  if (subscriptionError) {
    return NextResponse.json(
      { error: subscriptionError.message },
      { status: 500 }
    );
  }
  if (!subscription?.capture_id) {
    return NextResponse.json(
      { error: "This account is not authorised for that call transcript" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const { data: capture, error: captureError } = await supabaseService
    .from("meet_bots")
    .select("bot_id")
    .eq("workspace_id", accountScope.workspaceId)
    .eq("id", subscription.capture_id)
    .maybeSingle();
  if (captureError) {
    return NextResponse.json({ error: captureError.message }, { status: 500 });
  }
  if (!capture?.bot_id) {
    return NextResponse.json(
      { error: "The canonical call capture is unavailable" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const { data, error } = await supabaseService
    .from("meet_utterances")
    .select("speaker, role, text, ts")
    .eq("workspace_id", accountScope.workspaceId)
    .eq("bot_id", capture.bot_id)
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
