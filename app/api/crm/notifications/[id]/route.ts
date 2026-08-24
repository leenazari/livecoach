import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["read", "unread", "dismiss"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    if (!UUID.test(params.id)) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    const body = await req.json();
    const action = String(body?.action || "");
    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { error: "Choose read, unread or dismiss" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const patch =
      action === "dismiss"
        ? { read_at: now, dismissed_at: now }
        : { read_at: action === "read" ? now : null };
    const { data, error } = await supabaseAdmin
      .from("crm_notifications")
      .update(patch)
      .eq("id", params.id)
      .eq("workspace_id", account.workspaceId)
      .eq("user_id", account.userId)
      .select("id,read_at,dismissed_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      notification: {
        id: data.id,
        readAt: data.read_at,
        dismissedAt: data.dismissed_at,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Notification could not be updated" },
      { status: 500 }
    );
  }
}
