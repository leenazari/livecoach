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
import { requireRequestScope } from "@/lib/request-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { normaliseCompanyName } from "@/lib/company-identity";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import {
  followUpAtIsPast,
  normaliseFollowUpAt,
} from "@/lib/follow-up-scheduling";
import {
  activeSharedClientIds,
  loadSafeSharedCompanies,
} from "@/lib/team-client-sharing";

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

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MANUAL_ACTIONS = new Set(["task", "call", "email"]);

// POST /api/crm/tasks -> create one confirmed Brain/manual to-do. The assistant
// shows the exact item first, then calls this route only after approval.
export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const text = cleanText(body.text);
    if (typeof text !== "string" || !text.trim())
      return NextResponse.json({ error: "task text is required" }, { status: 400 });
    const requestId =
      typeof body.requestId === "string" ? body.requestId.trim() : "";
    const manualRequest = Boolean(requestId);
    if (body.requestId != null && !UUID.test(requestId)) {
      return NextResponse.json(
        { error: "Refresh the task form and try again" },
        { status: 400 }
      );
    }
    const action = String(body.action || "task").trim().toLowerCase();
    if (manualRequest && !MANUAL_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: "Choose a valid task type" },
        { status: 400 }
      );
    }

    const rawCompanyId =
      typeof body.companyId === "string" ? body.companyId.trim() : "";
    if (rawCompanyId && !UUID.test(rawCompanyId)) {
      return NextResponse.json(
        { error: "Choose a valid CRM client" },
        { status: 400 }
      );
    }
    let companyId: string | null = rawCompanyId || null;
    let prospectLinkedCompanyId: string | null = null;

    const outreachProspectId =
      typeof body.outreachProspectId === "string"
        ? body.outreachProspectId.trim()
        : "";
    let outreachProspect: any = null;
    if (outreachProspectId) {
      if (!UUID.test(outreachProspectId)) {
        return NextResponse.json(
          { error: "Choose a valid outreach prospect" },
          { status: 400 }
        );
      }
      const { data, error } = await supabaseAdmin
        .from("outreach_prospects")
        .select("id,first_name,last_name,company_name,crm_company_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("assigned_to_user_id", scope.userId)
        .eq("id", outreachProspectId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "task_prospect_not_assigned",
            title: "To-do not added",
            reason: "This outreach prospect is not assigned to your account",
            nextAction: "Refresh Outreach and check the prospect owner before adding the to-do again",
            responsible: "manager",
          }),
          { status: 404 }
        );
      }
      outreachProspect = data;
      const linkedCompanyId = UUID.test(String(data.crm_company_id || ""))
        ? String(data.crm_company_id)
        : null;
      prospectLinkedCompanyId = linkedCompanyId;
      if (companyId && linkedCompanyId && companyId !== linkedCompanyId) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "task_prospect_client_mismatch",
            title: "To-do not added",
            reason: "The selected client does not match this prospect's linked CRM client",
            nextAction: "Open the prospect's CRM record and correct its client link before adding the to-do",
            responsible: "manager",
          }),
          { status: 409 }
        );
      }
      if (!companyId && linkedCompanyId) {
        const linkedAccess = await loadAssignedClientAccess(
          linkedCompanyId,
          scope
        );
        companyId = linkedAccess?.company?.id || null;
      }
    }

    const rawDueAt =
      typeof body.dueAt === "string" ? body.dueAt.trim() : "";
    const scheduledTime = Boolean(rawDueAt && !DATE_ONLY.test(rawDueAt));
    const dueAt = rawDueAt
      ? DATE_ONLY.test(rawDueAt)
        ? rawDueAt
        : normaliseFollowUpAt(rawDueAt)
      : null;
    if (rawDueAt && !dueAt) {
      return NextResponse.json(
        { error: "Choose a valid due date and time" },
        { status: 400 }
      );
    }
    if (manualRequest && action === "call" && (!dueAt || !scheduledTime)) {
      return NextResponse.json(
        { error: "Call and follow-up tasks need a due date and time" },
        { status: 400 }
      );
    }
    if (manualRequest && dueAt && scheduledTime && followUpAtIsPast(dueAt)) {
      return NextResponse.json(
        { error: "Choose a due time that has not already passed" },
        { status: 400 }
      );
    }

    if (companyId) {
      const access = await loadAssignedClientAccess(companyId, scope);
      if (!access) {
        // An outreach record can retain an old CRM company id after ownership
        // changes. Keep the salesperson's task and its prospect context, but do
        // not expose or attach the inaccessible company.
        if (outreachProspect && companyId === prospectLinkedCompanyId) {
          companyId = null;
        } else {
          return NextResponse.json(
            crmBlockerPayload({
              code: "task_client_not_assigned",
              title: "To-do not added",
              reason: "The selected client is not owned by or assigned to your account",
              nextAction: "Ask a workspace owner to assign the client, then add the to-do again",
              responsible: "owner",
            }),
            { status: 404 }
          );
        }
      }
      const expectedCompanyName =
        typeof body.companyName === "string" ? body.companyName.trim() : "";
      if (
        access &&
        expectedCompanyName &&
        normaliseCompanyName(expectedCompanyName) !==
          normaliseCompanyName(access.company.name)
      ) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "task_client_mismatch",
            title: "To-do not added",
            reason: `The to-do names ${expectedCompanyName}, but the selected client is ${access.company.name}`,
            nextAction: "Open or choose the correct client, then add the to-do again",
            responsible: "user",
          }),
          { status: 409 }
        );
      }
    }
    if (manualRequest && action === "email" && !companyId && !outreachProspect) {
      return NextResponse.json(
        { error: "Choose the client or prospect this email task is for" },
        { status: 400 }
      );
    }
    const taskText = text.slice(0, 500);
    const sourceRef = manualRequest ? `manual_task:${requestId}` : null;
    const prospectName = outreachProspect
      ? [outreachProspect.first_name, outreachProspect.last_name]
          .map((part) => cleanText(part))
          .filter(Boolean)
          .join(" ")
          .slice(0, 240)
      : null;
    const manualPayload = manualRequest
      ? {
          pinned: body.pinned === true,
          scheduledTime,
          lastRequestId: requestId,
          outreachProspectId: outreachProspect?.id || null,
          prospectName: prospectName || null,
          companyName: outreachProspect
            ? String(cleanText(outreachProspect.company_name) || "").slice(0, 160) || null
            : null,
        }
      : null;
    const created = await upsertTasks(companyId, [
      {
        text: taskText,
        kind: manualRequest ? "manual" : undefined,
        linkKind: actionToLinkKind(action),
        source: manualRequest ? "manual_task" : "assistant",
        sourceRef,
        payload: manualPayload,
        dueAt,
        pinned: body.pinned === true,
        fingerprintKey: sourceRef,
      },
    ]);
    let task = created[0] || null;

    // A retry or a near-duplicate is not a failed save. Resolve the canonical
    // stored task and return its id so Brain can prove exactly what exists.
    if (!task) {
      const account = await resolveRecordScope(scope.userId);
      if (sourceRef) {
        const { data: exactRetry, error: exactRetryError } = await supabaseAdmin
          .from("tasks")
          .select(
            "id, company_id, workstream_id, text, kind, link_kind, status, done_at, created_at, payload, due_at, fingerprint, source_ref"
          )
          .eq("workspace_id", account.workspaceId)
          .eq("owner_id", account.userId)
          .eq("source_ref", sourceRef)
          .maybeSingle();
        if (exactRetryError) throw exactRetryError;
        task = exactRetry || null;
      }
    }
    if (!task) {
      const account = await resolveRecordScope(scope.userId);
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
      const fingerprint = fingerprintTask(
        companyId,
        sourceRef ? `request ${sourceRef}` : taskText
      );
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
    const searchParams = new URL(req.url).searchParams;
    const companyId = searchParams.get("companyId");
    const dashboardView = searchParams.get("view") === "dashboard";

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

    let completedQuery = supabaseAdmin
      .from("tasks")
      .select(
        "id, company_id, text, kind, link_kind, status, done_at, created_at, payload, due_at"
      )
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("status", "done")
      .order("done_at", { ascending: false })
      .limit(dashboardView ? 500 : 0);
    if (companyId) completedQuery = completedQuery.eq("company_id", companyId);

    const [taskResult, upcomingResult, completedResult] = await Promise.all([
      q,
      uq,
      dashboardView
        ? completedQuery
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (taskResult.error) throw taskResult.error;
    if (upcomingResult.error) throw upcomingResult.error;
    if (completedResult.error) throw completedResult.error;
    const rows = taskResult.data || [];
    const ucals = upcomingResult.data || [];
    const completedRows = completedResult.data || [];
    const companyIds = [
      ...new Set(
        [...rows, ...ucals, ...completedRows]
          .map((row: any) => row.company_id)
          .filter(Boolean)
      ),
    ];
    const [ownedCompaniesResult, assignedClientIds] = await Promise.all([
      companyIds.length
        ? supabaseAdmin
            .from("companies")
            .select("id, name")
            .eq("workspace_id", account.workspaceId)
            .eq("owner_id", account.userId)
            .in("id", companyIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      activeSharedClientIds(account.workspaceId, account.userId),
    ]);
    if (ownedCompaniesResult.error) throw ownedCompaniesResult.error;
    const companyIdSet = new Set(companyIds);
    const assignedCompanies = await loadSafeSharedCompanies(
      assignedClientIds.filter((id) => companyIdSet.has(id)),
      account.workspaceId
    );

    const nameById = new Map<string, string>();
    for (const c of [
      ...(ownedCompaniesResult.data || []),
      ...assignedCompanies,
    ]) {
      nameById.set(c.id, c.name);
    }

    // "Takes priority if within 48hrs of the call or the same day."
    const soonCutoff = Date.now() + 48 * 60 * 60 * 1000;

    const real = rows.map((t: any) => ({
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
    const uniqueUcals = ucals
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

    const completed = completedRows.map((t: any) => ({
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

    // Order: imminent prep first, then open work, then later prep. Completed or
    // dismissed work is never returned to the compact lists. The dedicated
    // dashboard deliberately appends owner-scoped completed work so the user
    // can audit or reopen it without creating a second task store.
    const tasks = dashboardView
      ? [...dueSoonPrep, ...real, ...laterPrep, ...completed]
      : [...dueSoonPrep, ...real, ...laterPrep];

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
