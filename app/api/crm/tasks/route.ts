import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  actionToLinkKind,
  fingerprintTask,
  isNearDuplicateTask,
  upsertTasks,
} from "@/lib/tasks";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import { resolveRecordScope } from "@/lib/record-scope";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

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

// POST /api/crm/tasks -> create one confirmed Brain/manual to-do. The assistant
// shows the exact item first, then calls this route only after approval.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = cleanText(body.text);
    if (typeof text !== "string" || !text.trim())
      return NextResponse.json({ error: "task text is required" }, { status: 400 });
    const companyId =
      typeof body.companyId === "string" && /^[0-9a-f-]{36}$/i.test(body.companyId)
        ? body.companyId
        : null;
    const dueAt =
      typeof body.dueAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(body.dueAt)
        ? body.dueAt
        : null;
    const taskText = text.slice(0, 500);
    const created = await upsertTasks(companyId, [
      {
        text: taskText,
        linkKind: actionToLinkKind(body.action),
        source: "assistant",
        dueAt,
        pinned: body.pinned === true,
      },
    ]);
    let task = created[0] || null;

    // A retry or a near-duplicate is not a failed save. Resolve the canonical
    // stored task and return its id so Brain can prove exactly what exists.
    if (!task) {
      const account = await resolveRecordScope();
      let existingQuery = supabaseAdmin
        .from("tasks")
        .select(
          "id, company_id, workstream_id, text, kind, link_kind, status, done_at, created_at, payload, due_at, fingerprint"
        )
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(500);
      existingQuery = companyId
        ? existingQuery.eq("company_id", companyId)
        : existingQuery.is("company_id", null);
      const { data: existing, error: existingError } = await existingQuery;
      if (existingError) throw existingError;
      const fingerprint = fingerprintTask(companyId, taskText);
      task = (existing || []).find(
        (row: any) =>
          row.fingerprint === fingerprint ||
          isNearDuplicateTask(taskText, String(row.text || ""))
      );
    }
    if (!task?.id) {
      return NextResponse.json(
        { ok: false, error: "The task was not written or matched to an existing open task." },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      task,
      created: created.length > 0,
      alreadyExists: created.length === 0,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to create task" },
      { status: 500 }
    );
  }
}

// GET /api/crm/tasks[?companyId=] -> the live OPEN to-do list. A ticked or
// dismissed item must disappear immediately and stay gone after refresh.
export async function GET(req: NextRequest) {
  try {
    const account = await resolveRecordScope();
    const companyId = new URL(req.url).searchParams.get("companyId");

    let q = supabaseAdmin
      .from("tasks")
      .select(
        "id, company_id, text, kind, link_kind, status, done_at, created_at, payload, due_at"
      )
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("status", "open")
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
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
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

    const [{ data: rows }, { data: ucals }] = await Promise.all([q, uq]);
    const companyIds = [
      ...new Set(
        [...(rows || []), ...(ucals || [])]
          .map((row: any) => row.company_id)
          .filter(Boolean)
      ),
    ];
    const { data: companies } = companyIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id, name")
          .eq("workspace_id", account.workspaceId)
          .in("id", companyIds)
      : { data: [] as any[] };

    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);

    // "Takes priority if within 48hrs of the call or the same day."
    const soonCutoff = Date.now() + 48 * 60 * 60 * 1000;

    const real = (rows || []).map((t: any) => ({
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

    // Priority sort for the open to-dos: PINNED first (kept at the top until
    // done), then by DEADLINE (soonest, and overdue, first), then most recent.
    // So a task the user pinned or gave a Friday deadline rises to the top
    // instead of sinking by age.
    const pinRank = (t: any) =>
      t.payload && typeof t.payload === "object" && t.payload.pinned ? 0 : 1;
    const dueMs = (t: any) =>
      t.due_at ? new Date(t.due_at).getTime() : Infinity;
    real.sort((a: any, b: any) => {
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
    const uniqueUcals = (ucals || [])
      .filter((u: any) => isPrepEligibleCalendarEvent(u))
      .filter((u: any) => {
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

    // Order: imminent prep first, then open work, then later prep. Completed or
    // dismissed work is never returned, so it cannot resurrect on refresh.
    const tasks = [...dueSoonPrep, ...real, ...laterPrep];

    return NextResponse.json(
      { tasks },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load tasks" },
      { status: 500 }
    );
  }
}
