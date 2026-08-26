import { NextResponse } from "next/server";
import { reconcileSenderAfterConnectorDisconnect } from "@/lib/connector-disconnect";
import { disconnectMicrosoftConnection } from "@/lib/microsoft";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  try {
    const scope = requireRequestScope();
    const result = await disconnectMicrosoftConnection();
    let identity = { provider: null, senderEmail: null } as {
      provider: "google" | "microsoft" | null;
      senderEmail: string | null;
    };
    let warning: string | null = null;
    try {
      identity = await reconcileSenderAfterConnectorDisconnect(scope, result.email);
    } catch (error: any) {
      console.error("Microsoft disconnected but sender reconciliation failed", error?.message || error);
      warning = "Microsoft was disconnected. Refresh Settings to confirm the remaining sender.";
    }
    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        source: "human",
        action: "microsoft_connector_disconnected",
        target_table: "microsoft_oauth",
        target_id: scope.userId,
        previous_scope: { connected: result.disconnected },
        next_scope: { connected: false, remaining_provider: identity.provider },
      });
    if (auditError)
      console.error("Microsoft disconnect audit failed", auditError.message);
    return NextResponse.json(
      { ok: true, disconnected: result.disconnected, identity, warning },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Microsoft could not be disconnected" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
