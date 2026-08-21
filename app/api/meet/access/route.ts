import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";
import {
  getTranscriberIdentity,
  validMeetSessionId,
  workerWebSocketUrl,
} from "@/lib/transcriber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const scope = await resolveRecordScope();
    const body = await req.json();
    const sessionId = body?.sessionId;
    if (!validMeetSessionId(sessionId)) {
      return NextResponse.json(
        { error: "A valid LiveCoach call session is required" },
        { status: 400 }
      );
    }

    const identity = await getTranscriberIdentity(scope.userId);
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const { error } = await supabaseService.from("meet_stream_tokens").upsert(
      {
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        session_id: sessionId,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        revoked_at: null,
        last_used_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "owner_id,session_id" }
    );
    if (error) throw error;

    return NextResponse.json(
      {
        token: rawToken,
        expiresAt: expiresAt.toISOString(),
        workerWs: workerWebSocketUrl(),
        ...identity,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The private transcript stream is unavailable" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
