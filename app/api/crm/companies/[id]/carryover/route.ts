import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CALL CARRY-OVER. Everything a recurring call needs to pick up where the last
// one left off, so a brainstorm or standup never starts from a blank slate:
// - the last call's recap (what happened, what each side is doing next),
// - the open items carried forward from the AI summaries (the evolving list),
// - a STANDING CHECKLIST the user maintains by hand and reuses every time.
// Read on the call screen when a client is linked.

const arr = (v: any): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const companyId = params.id;
    const [{ data: company }, { data: sumRows }, { data: taskRows }] =
      await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("profile")
          .eq("id", companyId)
          .maybeSingle(),
        supabaseAdmin
          .from("interview_summaries")
          .select("summary, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(1),
        supabaseAdmin
          .from("tasks")
          .select("text, kind, status, created_at")
          .eq("company_id", companyId)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

    const profile = (company?.profile || {}) as any;
    const checklist = arr(profile.checklist);

    const row = (sumRows || [])[0] as any;
    const s = row?.summary || {};
    const lastCall = row
      ? {
          date: row.created_at || null,
          headline: typeof s.headline === "string" ? s.headline : "",
          overview: typeof s.overview === "string" ? s.overview : "",
          myNextActions: arr(s.myNextActions).slice(0, 6),
          theirNextActions: arr(s.theirNextActions).slice(0, 6),
        }
      : null;

    // The carried, evolving checklist: open next-step / commitment / manual
    // tasks (skip the derived "prep" items and draft emails - those aren't the
    // conversation's own open threads).
    const openItems = (taskRows || [])
      .filter((t: any) => ["next_step", "commitment", "manual"].includes(t.kind))
      .map((t: any) => (typeof t.text === "string" ? t.text.trim() : ""))
      .filter(Boolean)
      .slice(0, 12);

    return NextResponse.json({ lastCall, checklist, openItems });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load carry-over" },
      { status: 500 }
    );
  }
}

// PUT { checklist: string[] } -> save the STANDING checklist onto the client
// (profile.checklist), preserving the rest of the profile. This is the list the
// user maintains and reuses across the recurring series.
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const checklist = arr(body.checklist)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 50);

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("profile")
      .eq("id", params.id)
      .maybeSingle();
    const profile = (company?.profile || {}) as any;

    const { error } = await supabaseAdmin
      .from("companies")
      .update({ profile: { ...profile, checklist } })
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true, checklist });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save the checklist" },
      { status: 500 }
    );
  }
}
