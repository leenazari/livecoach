import { NextResponse } from "next/server";
import { disconnectLinkedInConnection } from "@/lib/linkedin";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  try {
    const scope = requireRequestScope();
    const result = await disconnectLinkedInConnection();
    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        source: "human",
        action: "linkedin_connector_disconnected",
        target_table: "linkedin_oauth",
        target_id: scope.userId,
        previous_scope: { connected: result.disconnected },
        next_scope: { connected: false },
      });
    if (auditError) {
      console.error("LinkedIn disconnect audit failed", auditError.message);
    }
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "LinkedIn could not be disconnected" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
