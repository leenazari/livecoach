import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["owner", "manager"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (!["publish_team", "make_private", "archive"].includes(action)) {
      return NextResponse.json(
        { error: "Choose publish to team, make private or archive" },
        { status: 400 }
      );
    }
    const { data: current, error: currentError } = await supabaseAdmin
      .from("lessons")
      .select("id,owner_id,workspace_id,kind,status,visibility")
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      return NextResponse.json({ error: "Knowledge lesson not found" }, { status: 404 });
    }
    if (current.owner_id !== scope.userId) {
      return NextResponse.json(
        { error: "Only the lesson's author can change or archive it" },
        { status: 403 }
      );
    }
    if (action === "publish_team" && !MANAGER_ROLES.has(scope.role)) {
      return NextResponse.json(
        { error: "Only a workspace owner or manager can publish sales knowledge to the team" },
        { status: 403 }
      );
    }

    const next = action === "publish_team"
      ? { visibility: "team", status: "approved" }
      : action === "archive"
        ? { visibility: "private", status: "archived" }
        : { visibility: "private", status: "approved" };
    const { data: lesson, error } = await supabaseAdmin
      .from("lessons")
      .update(next)
      .eq("id", current.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .select("id,status,visibility,updated_at")
      .single();
    if (error) throw error;
    if (lesson.status !== next.status || lesson.visibility !== next.visibility) {
      throw new Error("LiveCoach did not confirm the requested knowledge access state");
    }
    return NextResponse.json({ ok: true, lesson });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Knowledge lesson was not updated" },
      { status: 500 }
    );
  }
}

// DELETE /api/crm/lessons/:id -> remove a lesson from the library.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const { data, error } = await supabaseAdmin
      .from("lessons")
      .delete()
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "lesson not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deletedId: data.id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete lesson" },
      { status: 500 }
    );
  }
}
