import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const scope = requireRequestScope();
    if (scope.status !== "active") return NextResponse.json({ error: "An active account is required" }, { status: 403, headers });
    const offset = Number(request.nextUrl.searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) return NextResponse.json({ error: "Invalid page" }, { status: 400, headers });
    const { data, error } = await supabaseAdmin.from("client_context")
      .select("id,title,content,company_id,created_at")
      .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId)
      .eq("metadata->>source", "notification_action")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 20);
    if (error) throw error;
    return NextResponse.json({ items: (data || []).slice(0, 20), hasMore: (data || []).length > 20 }, { headers });
  } catch { return NextResponse.json({ error: "Your action log could not be loaded" }, { status: 500, headers }); }
}
