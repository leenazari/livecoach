import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { googleCalendarNotification } from "@/lib/calendar-notification-auth";
import { kickCalendarSync } from "@/lib/calendar-sync-jobs";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const input = googleCalendarNotification(req.headers);
  if (!input) return new NextResponse(null, { status: 400 });
  const { data, error } = await supabaseService.rpc("accept_calendar_change", input);
  // Never acknowledge a notification that has not been durably queued.
  if (error) return new NextResponse(null, { status: 503 });
  for (const account of data || []) {
    waitUntil(kickCalendarSync({ workspaceId: account.workspace_id, userId: account.owner_id })
      .catch(() => console.error("Calendar notification queued for retry")));
  }
  // Duplicates, expired subscriptions and suspended users disclose no data.
  return new NextResponse(null, { status: 204 });
}
