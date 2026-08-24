import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { parseNotificationSnoozeUntil } from "@/lib/crm-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["read", "unread", "dismiss", "snooze"]);

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
        { error: "Choose read, unread, dismiss or snooze" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const snoozedUntil =
      action === "snooze"
        ? parseNotificationSnoozeUntil(body?.snoozedUntil)
        : null;
    if (action === "snooze" && !snoozedUntil) {
      return NextResponse.json(
        { error: "Choose a snooze time within the next 30 days" },
        { status: 400 }
      );
    }
    const patch =
      action === "dismiss"
        ? { read_at: now, dismissed_at: now, snoozed_until: null }
        : action === "snooze"
          ? { read_at: null, snoozed_until: snoozedUntil }
          : { read_at: action === "read" ? now : null, snoozed_until: null };
    const { data, error } = await supabaseAdmin
      .from("crm_notifications")
      .update(patch)
      .eq("id", params.id)
      .eq("workspace_id", account.workspaceId)
      .eq("user_id", account.userId)
      .select("id,read_at,dismissed_at,snoozed_until")
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
        snoozedUntil: data.snoozed_until,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Notification could not be updated" },
      { status: 500 }
    );
  }
}
