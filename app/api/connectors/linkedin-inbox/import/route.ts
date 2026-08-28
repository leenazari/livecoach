import { NextRequest, NextResponse } from "next/server";
import { LinkedInInboxContractError } from "@/lib/linkedin-inbox-contract";
import {
  authenticateLinkedInInboxConnector,
  bindLinkedInInboxExtensionOrigin,
  chromeExtensionOriginFromId,
  importLinkedInInboxBatch,
} from "@/lib/linkedin-inbox";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 512 * 1_024;

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, X-LiveCoach-Extension-Id",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Vary: "Origin",
});

const json = (
  body: Record<string, unknown>,
  status = 200
) => NextResponse.json(body, { status, headers: corsHeaders() });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: NextRequest) {
  const extensionOrigin = chromeExtensionOriginFromId(
    request.headers.get("x-livecoach-extension-id")
  );
  if (!extensionOrigin) {
    return NextResponse.json(
      { error: "connector extension identity is required" },
      { status: 403, headers: corsHeaders() }
    );
  }
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return json({ error: "application/json is required" }, 415);
    }
    const length = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
      return json({ error: "import batch is too large" }, 413);
    }
    const connector = await authenticateLinkedInInboxConnector(
      request.headers.get("authorization")
    );
    if (!connector) {
      return json({ error: "connector authentication failed" }, 401);
    }
    const boundConnector = await bindLinkedInInboxExtensionOrigin(
      connector,
      extensionOrigin
    );
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      return json({ error: "import batch is too large" }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "valid JSON is required" }, 400);
    }
    const result = await importLinkedInInboxBatch(boundConnector, body);

    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: boundConnector.workspace_id,
        actor_user_id: boundConnector.owner_id,
        source: "system",
        action: "linkedin_inbox_messages_imported",
        target_table: "linkedin_inbox_connectors",
        target_id: boundConnector.id,
        previous_scope: {},
        next_scope: {
          run_id: result.runId,
          accepted: result.accepted,
          imported: result.imported,
          duplicates: result.duplicates,
          linked: result.linked,
          review: result.review,
          contacts_created: result.contactsCreated,
        },
      });
    if (auditError) {
      console.error("LinkedIn inbox import audit failed", auditError.message);
    }
    return json({ ok: true, ...result });
  } catch (error: any) {
    const status =
      error instanceof LinkedInInboxContractError
        ? error.status
        : Number(error?.status) || 500;
    const safeStatus = [400, 401, 409, 413, 415, 429].includes(status)
      ? status
      : 500;
    if (safeStatus === 500) {
      console.error("LinkedIn inbox import failed", error?.message || error);
    }
    return json(
      {
        error:
          safeStatus === 500
            ? "LinkedIn inbox import failed"
            : String(error?.message || "LinkedIn inbox import failed"),
      },
      safeStatus
    );
  }
}
