import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// GET /api/crm/calls/:id -> one call's full scorecard, for the call-detail view.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data: call, error } = await supabaseAdmin
      .from("interview_summaries")
      .select("id, candidate, role, company_id, created_at, cost, summary, session_id, ref")
      .eq("id", params.id)
      .single();
    if (error) throw error;

    let company: string | null = null;
    if (call?.company_id) {
      const { data: c } = await supabaseAdmin
        .from("companies")
        .select("name")
        .eq("id", call.company_id)
        .single();
      company = c?.name || null;
    }

    // Richer call-event data from interview_sessions (the call record linked by
    // session_id): how long it ran, how much was said, and who was on it.
    let durationSeconds: number | null = null;
    let transcriptChars: number | null = null;
    let participants: string[] = [];
    if (call?.session_id) {
      const { data: sess } = await supabaseAdmin
        .from("interview_sessions")
        .select("started_at, ended_at, transcript")
        .eq("session_id", call.session_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sess) {
        if (sess.started_at && sess.ended_at) {
          const ms =
            new Date(sess.ended_at as string).getTime() -
            new Date(sess.started_at as string).getTime();
          if (ms > 0) durationSeconds = Math.round(ms / 1000);
        }
        if (typeof sess.transcript === "string") {
          transcriptChars = sess.transcript.length;
          // Participants = the distinct speaker labels at line starts
          // ("Name: ..."). Keeps it grounded in what was actually said.
          const names = new Set<string>();
          for (const line of sess.transcript.split("\n")) {
            const m = line.match(/^\s*([A-Za-z][\w .'-]{0,40}?):\s/);
            if (m) names.add(m[1].trim());
          }
          participants = Array.from(names).slice(0, 12);
        }
      }
    }

    // Fall back to the AI-extracted contributors if the transcript had no clear
    // speaker labels.
    if (participants.length === 0 && Array.isArray((call?.summary as any)?.contributors)) {
      participants = (call!.summary as any).contributors
        .map((c: any) => (typeof c?.name === "string" ? c.name.trim() : ""))
        .filter(Boolean)
        .slice(0, 12);
    }

    return NextResponse.json({
      call: {
        ...call,
        company,
        durationSeconds,
        transcriptChars,
        participants,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "call not found" },
      { status: 404 }
    );
  }
}
