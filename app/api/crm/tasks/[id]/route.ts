import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fingerprintTask } from "@/lib/tasks";

export const runtime = "nodejs";

// PATCH /api/crm/tasks/:id -> tick complete or re-open. Stamps done_at so the
// task lingers for the rest of today then auto-clears.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
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
      const text = body.text.trim();
      const { data: current, error: currentError } = await supabaseAdmin
        .from("tasks")
        .select("company_id")
        .eq("id", params.id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current)
        return NextResponse.json({ error: "task not found" }, { status: 404 });
      patch.text = text;
      patch.fingerprint = fingerprintTask(current.company_id || null, text);
    }
    // Save an edited commitment draft, or the pinned flag (payload.pinned).
    if (body.payload && typeof body.payload === "object")
      patch.payload = body.payload;
    // Set or clear a deadline (sorts the list; "" / null clears it).
    if (typeof body.dueAt === "string")
      patch.due_at = body.dueAt.trim() || null;
    else if (body.dueAt === null) patch.due_at = null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

    const { data, error } = await supabaseAdmin
      .from("tasks")
      .update(patch)
      .eq("id", params.id)
      .select("id, company_id, text, kind, status, due_at, payload")
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
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .delete()
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
