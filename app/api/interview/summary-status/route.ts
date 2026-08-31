import { NextRequest, NextResponse } from "next/server";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sessionId = String(req.nextUrl.searchParams.get("sessionId") || "").trim();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }
    const accountScope = await resolveRecordScope();

    const [{ data: summary, error: summaryError }, { data: session, error: sessionError }] =
      await Promise.all([
        supabaseAdmin
          .from("interview_summaries")
          .select("summary")
          .eq("workspace_id", accountScope.workspaceId)
          .eq("owner_id", accountScope.userId)
          .eq("session_id", sessionId)
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("interview_sessions")
          .select("summary_attempts,summary_error,summary_last_try")
          .eq("workspace_id", accountScope.workspaceId)
          .eq("owner_id", accountScope.userId)
          .eq("session_id", sessionId)
          .maybeSingle(),
      ]);
    if (summaryError) throw summaryError;
    if (sessionError) throw sessionError;
    if (summary?.summary) {
      return NextResponse.json(
        { state: "ready", summary: summary.summary },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (!session) {
      return NextResponse.json({ error: "call not found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        state: session.summary_error ? "retrying" : "processing",
        attempts: Number(session.summary_attempts || 0),
        error: session.summary_error || null,
        lastTryAt: session.summary_last_try || null,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "could not read summary status" },
      { status: 500 }
    );
  }
}
