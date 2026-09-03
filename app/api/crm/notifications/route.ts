import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";
import {
  mapNotificationPreferences,
  parseNotificationSnoozeUntil,
} from "@/lib/crm-notifications";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { outreachReplyHref } from "@/lib/crm-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mapNotification = (row: Record<string, any>) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  // Older database triggers stored a generic Replies tab link. Resolve the
  // canonical prospect here so old and new alerts both open the exact reply.
  href:
    row.kind === "outreach_reply" &&
    row.source_table === "outreach_prospects"
      ? outreachReplyHref(row.source_id) || row.href
      : row.href,
  sourceTable: row.source_table,
  sourceId: row.source_id,
  readAt: row.read_at,
  snoozedUntil: row.snoozed_until,
  attentionAt: row.attention_at || row.snoozed_until || row.created_at,
  createdAt: row.created_at,
});

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BULK_ACTIONS = new Set(["read", "unread", "dismiss", "snooze"]);

export async function GET(req: NextRequest) {
  try {
    const account = requireRequestScope();
    // Capture the baseline before querying. An event created while this read is
    // running will therefore still be newer than the client's saved cursor.
    const snapshotAt = new Date().toISOString();
    const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || 50);
    const limit = Math.min(100, Math.max(1, Math.round(requestedLimit) || 50));
    const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
    const activeSnoozeFilter = `snoozed_until.is.null,snoozed_until.lte.${snapshotAt}`;

    let listQuery = supabaseAdmin
      .from("crm_notifications")
      .select(
        "id,kind,title,body,href,source_table,source_id,read_at,snoozed_until,attention_at,created_at"
      )
      .eq("workspace_id", account.workspaceId)
      .eq("user_id", account.userId)
      .is("dismissed_at", null)
      .order("attention_at", { ascending: false })
      .limit(limit);
    if (unreadOnly)
      listQuery = listQuery.is("read_at", null).or(activeSnoozeFilter);

    const [
      listResult,
      countResult,
      chatCountResult,
      snoozedResult,
      preferencesResult,
    ] =
      await Promise.all([
        listQuery,
        supabaseAdmin
          .from("crm_notifications")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", account.workspaceId)
          .eq("user_id", account.userId)
          .is("dismissed_at", null)
          .is("read_at", null)
          .or(activeSnoozeFilter),
        supabaseAdmin
          .from("crm_notifications")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", account.workspaceId)
          .eq("user_id", account.userId)
          .eq("kind", "chat_message")
          .is("dismissed_at", null)
          .is("read_at", null)
          .or(activeSnoozeFilter),
        supabaseAdmin
          .from("crm_notifications")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", account.workspaceId)
          .eq("user_id", account.userId)
          .is("dismissed_at", null)
          .is("read_at", null)
          .gt("snoozed_until", snapshotAt),
        supabaseAdmin
          .from("crm_notification_preferences")
          .select(
            "reply_alerts,assignment_alerts,chat_alerts,chat_email_enabled,in_app_enabled,desktop_enabled,quiet_hours_enabled,quiet_start,quiet_end,timezone"
          )
          .eq("workspace_id", account.workspaceId)
          .eq("user_id", account.userId)
          .maybeSingle(),
      ]);
    if (listResult.error) throw listResult.error;
    if (countResult.error) throw countResult.error;
    if (chatCountResult.error) throw chatCountResult.error;
    if (snoozedResult.error) throw snoozedResult.error;
    if (preferencesResult.error) throw preferencesResult.error;

    return NextResponse.json(
      {
        notifications: (listResult.data || []).map(mapNotification),
        unreadCount: countResult.count || 0,
        chatUnreadCount: chatCountResult.count || 0,
        snoozedCount: snoozedResult.count || 0,
        preferences: mapNotificationPreferences(preferencesResult.data),
        currentUser: account.userId,
        serverTime: snapshotAt,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      crmBlockerPayload({
        code: "notifications_unavailable",
        title: "Notifications could not be loaded",
        reason: "LiveCoach could not safely read your notification feed",
        nextAction:
          "Refresh Notifications and try once. If it repeats, send the blocker code to a workspace owner",
        responsible: "system",
      }),
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const action = String(body?.action || "");
    if (action === "read_all") {
      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from("crm_notifications")
        .update({ read_at: now, snoozed_until: null })
        .eq("workspace_id", account.workspaceId)
        .eq("user_id", account.userId)
        .is("dismissed_at", null)
        .is("read_at", null)
        .or(`snoozed_until.is.null,snoozed_until.lte.${now}`)
        .select("id");
      if (error) throw error;

      return NextResponse.json({ ok: true, updated: data?.length || 0 });
    }

    const ids = Array.isArray(body?.ids)
      ? [...new Set(body.ids.map(String).filter((id: string) => UUID.test(id)))]
      : [];
    if (!BULK_ACTIONS.has(action) || !ids.length || ids.length > 100) {
      return NextResponse.json(
        { error: "Choose up to 100 notifications and a valid action" },
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
        : action === "read"
          ? { read_at: now, snoozed_until: null }
          : action === "unread"
            ? { read_at: null, snoozed_until: null }
            : { read_at: null, snoozed_until: snoozedUntil };
    const { data, error } = await supabaseAdmin
      .from("crm_notifications")
      .update(patch)
      .eq("workspace_id", account.workspaceId)
      .eq("user_id", account.userId)
      .is("dismissed_at", null)
      .in("id", ids)
      .select("id");
    if (error) throw error;

    return NextResponse.json({ ok: true, updated: data?.length || 0 });
  } catch {
    return NextResponse.json(
      crmBlockerPayload({
        code: "notification_action_not_confirmed",
        title: "Notification action not confirmed",
        reason: "LiveCoach could not safely update the selected notification state",
        nextAction:
          "Refresh Notifications and try once. If it repeats, send the blocker code to a workspace owner",
        responsible: "system",
      }),
      { status: 500 }
    );
  }
}
