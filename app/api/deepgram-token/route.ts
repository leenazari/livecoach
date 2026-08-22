import { NextRequest, NextResponse } from "next/server";
import { getRequestScope } from "@/lib/request-scope";
import {
  enforceAnonymousRealtimeAttempt,
  enforceRealtimeRateLimit,
  getCandidateSession,
  hasCandidateSessionCookie,
  RealtimeAccessError,
  realtimeErrorStatus,
  recordRealtimeEvent,
} from "@/lib/realtime-token-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mints a short-lived Deepgram access token (JWT) from the server-only API key
// via Deepgram's /auth/grant endpoint. The browser calls this and connects to
// Deepgram with the temporary token, so the real key never ships to the client.
//
// IMPORTANT: DEEPGRAM_API_KEY must be a **Member (or higher) permission** key —
// the /auth/grant endpoint rejects usage-only keys with a 403. Set it in
// Vercel > Project > Settings > Environment Variables (NOT prefixed with
// NEXT_PUBLIC_, so it stays server-side only).
export async function POST(req: NextRequest) {
  try {
    const scope = getRequestScope();
    if (!scope && hasCandidateSessionCookie(req)) {
      await enforceAnonymousRealtimeAttempt(req, "deepgram_candidate_access");
    }
    const candidate = scope ? null : await getCandidateSession(req);
    if (!scope && !candidate) {
      throw new RealtimeAccessError(
        "Active workspace access or a secure candidate session is required",
        401
      );
    }

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error("Deepgram is not configured");

    const workspaceId = scope?.workspaceId || candidate!.workspace_id;
    const actorUserId = scope?.userId || null;
    const targetId = scope?.userId || candidate!.id;
    await enforceRealtimeRateLimit({
      workspaceId,
      actorUserId,
      action: "deepgram_token_granted",
      targetId: actorUserId ? undefined : targetId,
      limit: 20,
      windowMs: 60 * 1000,
    });

    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      // 60s is ample: the token only needs to be valid at socket-open time.
      // Once the WebSocket handshake completes, the live connection persists
      // even after the token expires.
      body: JSON.stringify({ ttl_seconds: 60 }),
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Deepgram token grant failed", {
        status: res.status,
        detail: detail.slice(0, 300),
      });
      return NextResponse.json(
        { error: "Deepgram token grant failed" },
        { status: 502, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const data = await res.json();
    await recordRealtimeEvent({
      workspaceId,
      actorUserId,
      action: "deepgram_token_granted",
      targetTable: candidate ? "livekit_join_invites" : "workspace_members",
      targetId,
      metadata: {
        access: candidate ? "candidate_session" : "workspace_member",
        room_id: candidate?.room_id || null,
      },
    });
    return NextResponse.json(
      {
        access_token: data.access_token,
        expires_in: data.expires_in,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e: any) {
    const status = realtimeErrorStatus(e);
    return NextResponse.json(
      {
        error:
          status === 500
            ? "Deepgram token request could not be verified"
            : e?.message || "Deepgram token request was rejected",
      },
      { status, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
