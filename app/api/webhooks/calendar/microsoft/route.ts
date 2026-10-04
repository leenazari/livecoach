import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { calendarChannelId, microsoftCalendarNotification } from "@/lib/calendar-notification-auth";
import { kickCalendarSync } from "@/lib/calendar-sync-jobs";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get("channel");
  if (!calendarChannelId(channelId)) return new NextResponse(null, { status: 400 });
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (validationToken !== null) {
    if (validationToken.length > 4096) return new NextResponse(null, { status: 400 });
    return new NextResponse(validationToken, { headers: {
      "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  }
  const body = await req.text();
  if (body.length > 256000) return new NextResponse(null, { status: 413 });
  let values: any[];
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed?.value) || parsed.value.length > 100) throw new Error();
    values = parsed.value;
  } catch { return new NextResponse(null, { status: 400 }); }
  const accounts = new Map<string, { workspaceId: string; userId: string }>();
  const results = await Promise.all(values.map(async (value) => {
    const input = microsoftCalendarNotification(channelId, value);
    if (!input) return true;
    const { data, error } = await supabaseService.rpc("accept_calendar_change", input);
    if (error) return false;
    for (const account of data || []) accounts.set(`${account.workspace_id}:${account.owner_id}`, {
      workspaceId: account.workspace_id, userId: account.owner_id,
    });
    return true;
  }));
  for (const account of accounts.values()) {
    waitUntil(kickCalendarSync(account).catch(() => console.error("Calendar notification queued for retry")));
  }
  return new NextResponse(null, { status: results.every(Boolean) ? 202 : 503 });
}
