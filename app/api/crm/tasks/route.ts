import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Keep to-do text in the user's house style: no em/en dashes, no semicolons.
const cleanText = (s: any): any =>
  typeof s === "string"
    ? s
        .replace(/[—–]/g, ", ")
        .replace(/;/g, ",")
        .replace(/\s+([,.])/g, "$1")
        .replace(/,\s*,/g, ",")
        .replace(/\s{2,}/g, " ")
        .trim()
    : s;

// GET /api/crm/tasks[?companyId=] -> the live to-do list: every OPEN task plus
// tasks completed TODAY (so a ticked task lingers for the rest of the day then
// drops off on its own). Newest-relevant first. Joins the company name.
export async function GET(req: NextRequest) {
  try {
    const companyId = new URL(req.url).searchParams.get("companyId");

    // Start of today (server local) - done tasks older than this are hidden.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let q = supabaseAdmin
      .from("tasks")
      .select(
        "id, company_id, text, kind, link_kind, status, done_at, created_at, payload, due_at"
      )
      .order("created_at", { ascending: true })
      .limit(500);
    if (companyId) q = q.eq("company_id", companyId);

    // Prep to-dos are DERIVED from the linked upcoming calls (not stored), so
    // they always match the calendar, never duplicate, and disappear once the
    // call is prepped or has passed. Only client-linked, future, un-prepped
    // calls become a prep to-do (internal meetings with no client are skipped).
    let uq = supabaseAdmin
      .from("upcoming_calls")
      .select(
        "id, company_id, title, scheduled_at, meeting_url, intent, prepped, created_at"
      )
      .not("company_id", "is", null)
      .eq("prepped", false)
      // A finished call (completed_at set when the call ended) stops generating
      // a prep to-do immediately, so a done meeting never lingers here.
      .is("completed_at", null)
      // A prep to-do falls off once the call's time has passed by a short grace
      // window (3h), enough to still open or recap it just after, not linger.
      .gte("scheduled_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(200);
    if (companyId) uq = uq.eq("company_id", companyId);

    const [{ data: rows }, { data: ucals }, { data: companies }] =
      await Promise.all([
        q,
        uq,
        supabaseAdmin.from("companies").select("id, name"),
      ]);

    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);

    const startMs = startOfToday.getTime();
    // "Takes priority if within 48hrs of the call or the same day."
    const soonCutoff = Date.now() + 48 * 60 * 60 * 1000;

    const real = (rows || [])
      .filter((t: any) => {
        // Open tasks always show. Done tasks linger only for the rest of today.
        // Dismissed (or anything else) is hidden EVERYWHERE - the whole pipeline
        // reads this endpoint, so dismissing once removes it from the board,
        // dashboard and commitments at once.
        if (t.status === "open") return true;
        if (t.status === "done")
          return t.done_at && new Date(t.done_at).getTime() >= startMs;
        return false;
      })
      .map((t: any) => ({
        ...t,
        text: cleanText(t.text),
        company: t.company_id ? nameById.get(t.company_id) || null : null,
        upcoming_id: null,
        scheduled_at: null,
        meeting_url: null,
        intent: null,
        due_soon: false,
        payload: t.payload ?? null,
        due_at: t.due_at ?? null,
      }));
    const openReal = real.filter((t: any) => t.status !== "done");
    const doneReal = real.filter((t: any) => t.status === "done");

    // Priority sort for the open to-dos: PINNED first (kept at the top until
    // done), then by DEADLINE (soonest, and overdue, first), then most recent.
    // So a task the user pinned or gave a Friday deadline rises to the top
    // instead of sinking by age.
    const pinRank = (t: any) =>
      t.payload && typeof t.payload === "object" && t.payload.pinned ? 0 : 1;
    const dueMs = (t: any) =>
      t.due_at ? new Date(t.due_at).getTime() : Infinity;
    openReal.sort((a: any, b: any) => {
      const pr = pinRank(a) - pinRank(b);
      if (pr !== 0) return pr;
      const dm = dueMs(a) - dueMs(b);
      if (dm !== 0) return dm;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Collapse repetitive meetings: a recurring title (a daily standup, a weekly
    // review) should appear ONCE in the prep list, as its NEXT instance, not as
    // a wall of identical items stretching weeks out. ucals is already ordered
    // soonest-first, so the first time we see a title is the next occurrence.
    const seenPrepTitles = new Set<string>();
    const uniqueUcals = (ucals || []).filter((u: any) => {
      const key = String(u.title || "").toLowerCase().trim();
      if (!key) return true;
      if (seenPrepTitles.has(key)) return false;
      seenPrepTitles.add(key);
      return true;
    });

    // Build the prep to-dos from the upcoming client calls.
    const prep = uniqueUcals.map((u: any) => {
      const ms = u.scheduled_at ? new Date(u.scheduled_at).getTime() : null;
      const due_soon = ms != null && ms <= soonCutoff;
      return {
        id: `upcoming:${u.id}`,
        upcoming_id: u.id,
        company_id: u.company_id,
        company: u.company_id ? nameById.get(u.company_id) || null : null,
        text: `Prep: ${u.title || "call"}`,
        kind: "prep",
        link_kind: "call",
        status: "open",
        done_at: null,
        created_at: u.created_at,
        scheduled_at: u.scheduled_at,
        meeting_url: u.meeting_url || null,
        intent: u.intent || null,
        due_soon,
      };
    });
    const dueSoonPrep = prep.filter((p) => p.due_soon);
    const laterPrep = prep.filter((p) => !p.due_soon);

    // Order: imminent prep first (soonest first), then the rest of the open
    // list, then prep that's further out, then today's completed tasks.
    const tasks = [...dueSoonPrep, ...openReal, ...laterPrep, ...doneReal];

    return NextResponse.json({ tasks });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load tasks" },
      { status: 500 }
    );
  }
}
