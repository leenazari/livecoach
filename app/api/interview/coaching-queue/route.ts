import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Powers the Call coach screen: every coachable call (one with a transcript) and
// any speaking-coaching points generated for it, in one list - so the training
// for all calls is in one place, no need to open each call.
export async function GET() {
  try {
    const [{ data: summaries }, { data: companies }, { data: coachable }] =
      await Promise.all([
        supabaseAdmin
          .from("interview_summaries")
          .select("id, candidate, company_id, created_at, session_id, summary")
          .order("created_at", { ascending: false })
          .limit(60),
        supabaseAdmin.from("companies").select("id, name"),
        supabaseAdmin
          .from("interview_sessions")
          .select("session_id")
          .not("transcript", "is", null),
      ]);

    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);
    const coachableSet = new Set(
      (coachable || []).map((s: any) => s.session_id).filter(Boolean)
    );

    const calls = (summaries || []).filter(
      (s: any) => s.session_id && coachableSet.has(s.session_id)
    );

    const sessionIds = calls.map((s: any) => s.session_id);
    const pointsBySession = new Map<string, any[]>();
    if (sessionIds.length) {
      const { data: points } = await supabaseAdmin
        .from("coaching_points")
        .select("id, session_id, quote, better, why, vote, created_at")
        .in("session_id", sessionIds)
        .order("created_at", { ascending: true });
      for (const p of points || []) {
        const arr = pointsBySession.get((p as any).session_id) || [];
        arr.push(p);
        pointsBySession.set((p as any).session_id, arr);
      }
    }

    const items = calls.map((s: any) => {
      const pts = pointsBySession.get(s.session_id) || [];
      const unvoted = pts.filter((p: any) => !p.vote).length;
      const status = pts.length === 0 ? "todo" : unvoted > 0 ? "review" : "done";
      const title =
        (s.summary && typeof s.summary === "object" && s.summary.title) ||
        s.candidate ||
        "Call";
      return {
        callId: s.id as string,
        candidate: s.candidate || null,
        company: s.company_id ? nameById.get(s.company_id) || null : null,
        created_at: s.created_at,
        title,
        status,
        points: pts.map((p: any) => ({
          id: p.id,
          quote: p.quote,
          better: p.better,
          why: p.why,
          vote: p.vote,
        })),
      };
    });

    const rank = (st: string) => (st === "todo" ? 0 : st === "review" ? 1 : 2);
    items.sort(
      (a: any, b: any) =>
        rank(a.status) - rank(b.status) ||
        (a.created_at < b.created_at ? 1 : -1)
    );

    const counts = {
      todo: items.filter((i: any) => i.status === "todo").length,
      review: items.filter((i: any) => i.status === "review").length,
      done: items.filter((i: any) => i.status === "done").length,
    };

    return NextResponse.json({ calls: items, counts });
  } catch (err: any) {
    return NextResponse.json({ calls: [], error: err?.message || "failed" });
  }
}
