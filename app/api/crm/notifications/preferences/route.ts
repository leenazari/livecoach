import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";
import {
  isValidClockTime,
  isValidTimezone,
  mapNotificationPreferences,
} from "@/lib/crm-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    const booleanKeys = [
      "replyAlerts",
      "assignmentAlerts",
      "chatAlerts",
      "chatEmailEnabled",
      "inAppEnabled",
      "desktopEnabled",
      "quietHoursEnabled",
    ] as const;
    if (
      booleanKeys.some((key) => typeof body?.[key] !== "boolean") ||
      !isValidClockTime(body?.quietStart) ||
      !isValidClockTime(body?.quietEnd) ||
      body.quietStart === body.quietEnd ||
      !isValidTimezone(body?.timezone)
    ) {
      return NextResponse.json(
        { error: "Check the notification settings and quiet-hour times" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("crm_notification_preferences")
      .upsert(
        {
          workspace_id: account.workspaceId,
          user_id: account.userId,
          reply_alerts: body.replyAlerts,
          assignment_alerts: body.assignmentAlerts,
          chat_alerts: body.chatAlerts,
          chat_email_enabled: body.chatEmailEnabled,
          in_app_enabled: body.inAppEnabled,
          desktop_enabled: body.desktopEnabled,
          quiet_hours_enabled: body.quietHoursEnabled,
          quiet_start: body.quietStart,
          quiet_end: body.quietEnd,
          timezone: body.timezone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,user_id" }
      )
      .select(
        "reply_alerts,assignment_alerts,chat_alerts,chat_email_enabled,in_app_enabled,desktop_enabled,quiet_hours_enabled,quiet_start,quiet_end,timezone"
      )
      .single();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      preferences: mapNotificationPreferences(data),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Notification settings could not be saved" },
      { status: 500 }
    );
  }
}
