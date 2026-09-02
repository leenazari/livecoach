import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { actionToLinkKind, fingerprintTask } from "@/lib/tasks";
import { capitaliseSentenceStarts } from "@/lib/text";
import { requireRequestScope } from "@/lib/request-scope";
import {
  followUpAtIsPast,
  normaliseFollowUpAt,
} from "@/lib/follow-up-scheduling";

export const runtime = "nodejs";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// PATCH /api/crm/tasks/:id -> tick complete or re-open. Stamps done_at so the
// task lingers for the rest of today then auto-clears.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const { data: current, error: currentError } = await supabaseAdmin
      .from("tasks")
      .select("id,company_id,payload,status")
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current)
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    const patch: Record<string, any> = {};
    if (body.status === "done") {
      patch.status = "done";
      patch.done_at = new Date().toISOString();
    } else if (body.status === "open") {
      patch.status = "open";
      patch.done_at = null;
    } else if (body.status === "dismissed") {
      // Dismissed = gone from the whole pipeline (board, dashboard, commitments)
      // but kept as a row so its fingerprint stops the jobs re-creating it.
      patch.status = "dismissed";
    }
    if (typeof body.text === "string" && body.text.trim()) {
      const text = capitaliseSentenceStarts(body.text.trim());
      patch.text = text;
      // Explicit manual reminders use a request-scoped fingerprint so the
      // browser can retry safely and the same wording can be scheduled again
      // after an older reminder is complete. Preserve that boundary on edits.
      if (!current.payload?.lastRequestId) {
        patch.fingerprint = fingerprintTask(current.company_id || null, text);
      }
    }
    // Save an edited commitment draft, or the pinned flag (payload.pinned).
    if (body.payload && typeof body.payload === "object")
      patch.payload = {
        ...(current.payload && typeof current.payload === "object"
          ? current.payload
          : {}),
        ...body.payload,
      };
    if (typeof body.action === "string")
      patch.link_kind = actionToLinkKind(body.action);
    // Set or clear a deadline. Browser date-time controls send a zoned value,
    // while a date without a time remains an all-day deadline.
    if (typeof body.dueAt === "string") {
      const rawDueAt = body.dueAt.trim();
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
      if (
        current.status === "open" &&
        dueAt &&
        scheduledTime &&
        followUpAtIsPast(dueAt)
      ) {
        return NextResponse.json(
          { error: "Choose a due time that has not already passed" },
          { status: 400 }
        );
      }
      patch.due_at = dueAt;
      patch.payload = {
        ...(current.payload && typeof current.payload === "object"
          ? current.payload
          : {}),
        ...(patch.payload && typeof patch.payload === "object"
          ? patch.payload
          : {}),
        scheduledTime,
      };
    } else if (body.dueAt === null) {
      patch.due_at = null;
      patch.payload = {
        ...(current.payload && typeof current.payload === "object"
          ? current.payload
          : {}),
        ...(patch.payload && typeof patch.payload === "object"
          ? patch.payload
          : {}),
        scheduledTime: false,
      };
    }

    // Reset the 60-day retention clock whenever an open task is meaningfully
    // edited or reopened. The tasks table deliberately has no updated_at, so
    // this timestamp prevents a recently maintained old task being archived.
    const touched =
      body.status === "open" ||
      (typeof body.text === "string" && body.text.trim()) ||
      (body.payload && typeof body.payload === "object") ||
      typeof body.action === "string" ||
      typeof body.dueAt === "string" ||
      body.dueAt === null;
    if (touched) {
      patch.payload = {
        ...(current.payload && typeof current.payload === "object"
          ? current.payload
          : {}),
        ...(patch.payload && typeof patch.payload === "object"
          ? patch.payload
          : {}),
        retentionTouchedAt: new Date().toISOString(),
      };
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

    const { data, error } = await supabaseAdmin
      .from("tasks")
      .update(patch)
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("id", params.id)
      .select(
        "id, company_id, text, kind, link_kind, status, done_at, created_at, due_at, payload"
      )
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    return NextResponse.json(
      { ok: true, task: data },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update task" },
      { status: 500 }
    );
  }
}

// DELETE /api/crm/tasks/:id -> remove it from the list now.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .delete()
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "task not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deletedId: data.id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete task" },
      { status: 500 }
    );
  }
}
