import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// PATCH  /api/crm/opportunities/:id -> update status (open|won|lost|dismissed)
//        or edit title/detail/value.
// DELETE /api/crm/opportunities/:id
const STATUSES = ["open", "won", "lost", "dismissed"];
const OWNER_TYPES = ["us", "buyer", "joint"];

const cleanClosePlan = (value: any) => {
  const targetCloseDate =
    typeof value?.targetCloseDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.targetCloseDate)
      ? value.targetCloseDate
      : null;
  const milestones = Array.isArray(value?.milestones)
    ? value.milestones
        .filter((m: any) => m && typeof m.label === "string" && m.label.trim())
        .slice(0, 20)
        .map((m: any) => ({
          id:
            typeof m.id === "string" && m.id.trim()
              ? m.id.trim().slice(0, 80)
              : crypto.randomUUID(),
          label: m.label.trim().slice(0, 200),
          owner: OWNER_TYPES.includes(m.owner) ? m.owner : "joint",
          dueAt:
            typeof m.dueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.dueAt)
              ? m.dueAt
              : null,
          status: m.status === "done" ? "done" : "pending",
        }))
    : [];
  return { targetCloseDate, milestones };
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const patch: Record<string, any> = {};
    if (typeof body.status === "string" && STATUSES.includes(body.status)) {
      patch.status = body.status;
    }
    if (typeof body.title === "string" && body.title.trim()) {
      patch.title = body.title.trim();
    }
    if (typeof body.detail === "string") patch.detail = body.detail.trim() || null;
    if (typeof body.value === "number") patch.value = body.value;
    if (body.value === null) patch.value = null;
    if (body.closePlan && typeof body.closePlan === "object") {
      patch.close_plan = cleanClosePlan(body.closePlan);
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .update(patch)
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ opportunity: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update opportunity" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .delete()
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete opportunity" },
      { status: 500 }
    );
  }
}
