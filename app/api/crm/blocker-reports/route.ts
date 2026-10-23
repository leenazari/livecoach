import { NextRequest, NextResponse } from "next/server";
import { getRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { crmBlockerDiagnostic } from "@/lib/crm-blocker-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  const scope = getRequestScope();
  if (!scope || scope.status !== "active") {
    return NextResponse.json({ error: "Active account required" }, { status: 403, headers });
  }
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Same origin required" }, { status: 403, headers });
  }
  // Bound input before parsing, even when Content-Length is absent or false.
  const reader = request.body?.getReader();
  let body = "";
  let bytes = 0;
  if (reader) {
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) { body += decoder.decode(); break; }
      bytes += chunk.value.byteLength;
      if (bytes > 2048) {
        await reader.cancel();
        return NextResponse.json({ error: "Report too large" }, { status: 413, headers });
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
  }
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  const diagnostic = crmBlockerDiagnostic({ ...parsed, url: parsed?.path });
  if (!diagnostic) return NextResponse.json({ error: "Invalid diagnostic" }, { status: 400, headers });
  try {
    const { count, error: countError } = await supabaseService.from("access_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", scope.workspaceId).eq("actor_user_id", scope.userId)
      .eq("action", "crm_request_blocker_reported")
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if (countError) throw countError;
    if ((count || 0) >= 20) return NextResponse.json({ error: "Report limit reached" }, { status: 429, headers });
    const { error } = await supabaseService.from("access_audit_events").insert({
      workspace_id: scope.workspaceId, actor_user_id: scope.userId,
      source: "human", action: "crm_request_blocker_reported", target_table: "crm_requests",
      metadata: { reportedBy: "browser", ...diagnostic },
    });
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    console.error("CRM blocker diagnostic could not be saved");
    return NextResponse.json({ error: "Diagnostic unavailable" }, { status: 503, headers });
  }
}
