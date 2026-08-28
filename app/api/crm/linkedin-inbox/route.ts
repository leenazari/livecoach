import { NextRequest, NextResponse } from "next/server";
import {
  generateLinkedInInboxToken,
  hashLinkedInInboxToken,
  loadLinkedInInboxConnectorForOwner,
} from "@/lib/linkedin-inbox";
import { LINKEDIN_INBOX_MAX_LOOKBACK_DAYS } from "@/lib/linkedin-inbox-contract";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

const connectorResponse = async (scope: {
  userId: string;
  workspaceId: string;
}) => {
  const connector = await loadLinkedInInboxConnectorForOwner(scope);
  if (!connector) {
    return {
      active: false,
      status: "not_created" as const,
      tokenLastFour: null,
      browserBound: false,
      maxConversations: 10,
      lookbackDays: 14,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      importedMessageCount: 0,
      reviewCount: 0,
    };
  }
  const { count, error } = await supabaseService
    .from("linkedin_inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("status", "review");
  if (error) throw error;
  return {
    active: connector.status === "active" && !connector.revoked_at,
    status: connector.status,
    tokenLastFour: connector.token_last_four,
    browserBound: !!connector.extension_origin,
    maxConversations: connector.max_conversations_per_run,
    lookbackDays: connector.lookback_days,
    lastRunAt: connector.last_run_at,
    lastSuccessAt: connector.last_success_at,
    lastError: connector.last_error,
    importedMessageCount: connector.imported_message_count,
    reviewCount: count || 0,
  };
};

export async function GET() {
  try {
    const scope = requireRequestScope();
    return NextResponse.json(await connectorResponse(scope), {
      headers: noStore,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not load the LinkedIn inbox connector" },
      { status: 403, headers: noStore }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const existing = await loadLinkedInInboxConnectorForOwner(scope);
    if (existing?.status === "active" && body.rotate !== true) {
      return NextResponse.json(
        { error: "A connector key already exists. Confirm replacement to rotate it." },
        { status: 409, headers: noStore }
      );
    }
    const maxConversations = Math.min(
      20,
      Math.max(1, Math.trunc(Number(body.maxConversations) || 10))
    );
    const lookbackDays = Math.min(
      LINKEDIN_INBOX_MAX_LOOKBACK_DAYS,
      Math.max(1, Math.trunc(Number(body.lookbackDays) || 14))
    );
    const token = generateLinkedInInboxToken();
    const tokenHash = hashLinkedInInboxToken(token);
    const now = new Date().toISOString();
    const values = {
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      visibility: "private",
      status: "active",
      token_hash: tokenHash,
      token_last_four: token.slice(-4),
      extension_origin: null,
      max_conversations_per_run: maxConversations,
      lookback_days: lookbackDays,
      revoked_at: null,
      last_error: null,
      updated_at: now,
    };
    const query = existing
      ? supabaseService
          .from("linkedin_inbox_connectors")
          .update(values)
          .eq("id", existing.id)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
      : supabaseService.from("linkedin_inbox_connectors").insert(values);
    const { data, error } = await query
      .select("id,status,token_last_four")
      .single();
    if (error) throw error;

    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        source: "human",
        action: existing
          ? "linkedin_inbox_connector_key_rotated"
          : "linkedin_inbox_connector_created",
        target_table: "linkedin_inbox_connectors",
        target_id: data.id,
        previous_scope: existing
          ? { status: existing.status, browser_bound: !!existing.extension_origin }
          : {},
        next_scope: {
          status: "active",
          browser_bound: false,
          max_conversations_per_run: maxConversations,
          lookback_days: lookbackDays,
        },
      });
    if (auditError) {
      console.error("LinkedIn inbox connector audit failed", auditError.message);
    }

    return NextResponse.json(
      {
        ok: true,
        token,
        tokenLastFour: data.token_last_four,
        active: data.status === "active",
        shownOnce: true,
      },
      { status: existing ? 200 : 201, headers: noStore }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not create the LinkedIn inbox connector" },
      { status: 500, headers: noStore }
    );
  }
}

export async function DELETE() {
  try {
    const scope = requireRequestScope();
    const existing = await loadLinkedInInboxConnectorForOwner(scope);
    if (!existing || existing.status === "revoked") {
      return NextResponse.json(
        { ok: true, active: false },
        { headers: noStore }
      );
    }
    const now = new Date().toISOString();
    const { data, error } = await supabaseService
      .from("linkedin_inbox_connectors")
      .update({
        status: "revoked",
        revoked_at: now,
        extension_origin: null,
        updated_at: now,
      })
      .eq("id", existing.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .select("id,status")
      .single();
    if (error) throw error;
    if (data.status !== "revoked") {
      throw new Error("The database did not confirm that revocation");
    }
    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        source: "human",
        action: "linkedin_inbox_connector_revoked",
        target_table: "linkedin_inbox_connectors",
        target_id: existing.id,
        previous_scope: { status: "active", browser_bound: !!existing.extension_origin },
        next_scope: { status: "revoked", browser_bound: false },
      });
    if (auditError) {
      console.error("LinkedIn inbox connector audit failed", auditError.message);
    }
    return NextResponse.json({ ok: true, active: false }, { headers: noStore });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not revoke the LinkedIn inbox connector" },
      { status: 500, headers: noStore }
    );
  }
}
