import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mapNotification = (row: Record<string, any>) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  href: row.href,
  sourceTable: row.source_table,
  sourceId: row.source_id,
  readAt: row.read_at,
  createdAt: row.created_at,
});

export async function GET(req: NextRequest) {
  try {
    const account = requireRequestScope();
    // Capture the baseline before querying. An event created while this read is
    // running will therefore still be newer than the client's saved cursor.
    const snapshotAt = new Date().toISOString();
    const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || 50);
    const limit = Math.min(100, Math.max(1, Math.round(requestedLimit) || 50));
    const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";

    let listQuery = supabaseAdmin
      .from("crm_notifications")
      .select(
        "id,kind,title,body,href,source_table,source_id,read_at,created_at"
      )
      .eq("workspace_id", account.workspaceId)
      .eq("user_id", account.userId)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (unreadOnly) listQuery = listQuery.is("read_at", null);

    const [listResult, countResult] = await Promise.all([
      listQuery,
      supabaseAdmin
        .from("crm_notifications")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", account.workspaceId)
        .eq("user_id", account.userId)
        .is("dismissed_at", null)
        .is("read_at", null),
    ]);
    if (listResult.error) throw listResult.error;
    if (countResult.error) throw countResult.error;

    return NextResponse.json(
      {
        notifications: (listResult.data || []).map(mapNotification),
        unreadCount: countResult.count || 0,
        currentUser: account.userId,
        serverTime: snapshotAt,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Notifications could not be loaded" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    if (body?.action !== "read_all") {
      return NextResponse.json(
        { error: "Choose the read all action" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("crm_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("workspace_id", account.workspaceId)
      .eq("user_id", account.userId)
      .is("dismissed_at", null)
      .is("read_at", null)
      .select("id");
    if (error) throw error;

    return NextResponse.json({ ok: true, updated: data?.length || 0 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Notifications could not be updated" },
      { status: 500 }
    );
  }
}
