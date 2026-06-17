import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isStaleTask, londonYMD, type StaleCtx } from "@/lib/stale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clear to-dos that have PASSED. Deterministic and conservative (see lib/stale):
// a prep task whose call has happened, a "tomorrow/today" that's gone, or an
// explicit past date. Dismissed (not deleted), so the background jobs won't
// recreate them. Safe to run often - it only does work when something's stale.

const norm = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

async function run() {
  try {
    const [{ data: tasks }, { data: companies }, { data: summaries }] =
      await Promise.all([
        supabaseAdmin
          .from("tasks")
          .select("id, company_id, text, link_kind, created_at")
          .eq("status", "open")
          .limit(500),
        supabaseAdmin.from("companies").select("id, name, profile"),
        supabaseAdmin
          .from("interview_summaries")
          .select("company_id, created_at")
          .not("company_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);

    const cos = (companies || []).map((c: any) => {
      const aliases = Array.isArray((c.profile || {}).aliases)
        ? (c.profile as any).aliases
        : [];
      const names = [c.name, ...aliases]
        .map((n: any) => norm(String(n || "")))
        .filter((n: string) => n.length >= 3);
      return { id: c.id as string, names };
    });

    const lastCallMsByCompany = new Map<string, number>();
    for (const s of summaries || []) {
      const cid = (s as any).company_id as string | null;
      if (!cid) continue;
      const ms = new Date((s as any).created_at).getTime();
      const cur = lastCallMsByCompany.get(cid);
      if (cur === undefined || ms > cur) lastCallMsByCompany.set(cid, ms);
    }

    const ctx: StaleCtx = {
      companies: cos,
      lastCallMsByCompany,
      todayYMD: londonYMD(new Date()),
    };

    const stale: { id: string; reason: string }[] = [];
    for (const t of tasks || []) {
      const r = isStaleTask(
        {
          company_id: (t as any).company_id,
          text: (t as any).text,
          link_kind: (t as any).link_kind,
          created_at: (t as any).created_at,
        },
        ctx
      );
      if (r.stale) stale.push({ id: (t as any).id as string, reason: r.reason });
    }

    if (stale.length) {
      await supabaseAdmin
        .from("tasks")
        .update({ status: "dismissed" })
        .in(
          "id",
          stale.map((s) => s.id)
        );
    }

    return NextResponse.json({
      ok: true,
      dismissed: stale.length,
      items: stale.slice(0, 50),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "sweep failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return run();
}
export async function POST() {
  return run();
}
