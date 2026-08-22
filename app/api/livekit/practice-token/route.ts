import { NextRequest, NextResponse } from "next/server";
import { createLiveKitToken } from "@/lib/livekit";
import { requireRequestScope } from "@/lib/request-scope";
import {
  claimLiveKitRoom,
  enforceRealtimeRateLimit,
  realtimeErrorStatus,
  recordRealtimeEvent,
} from "@/lib/realtime-token-security";
import { validMeetSessionId } from "@/lib/transcriber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The practice candidate is an authenticated internal harness. Keeping it on
// a separate route means the normal staff token endpoint never accepts a role
// selector from the browser.
export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const room = typeof body?.room === "string" ? body.room : "";
    if (!validMeetSessionId(room)) {
      return NextResponse.json(
        { error: "A valid LiveCoach call room is required" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    await claimLiveKitRoom(scope, room);
    await enforceRealtimeRateLimit({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "livekit_practice_token_granted",
      limit: 12,
      windowMs: 60 * 1000,
    });
    const token = await createLiveKitToken({
      room,
      identity: `practice-${scope.userId}`,
      displayName: "Candidate (bot)",
      role: "candidate",
    });
    await recordRealtimeEvent({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "livekit_practice_token_granted",
      targetTable: "livekit_rooms",
      targetId: room,
      metadata: { role: "candidate", practice: true },
    });
    return NextResponse.json(
      { token, url: process.env.NEXT_PUBLIC_LIVEKIT_URL, role: "candidate" },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    const status = realtimeErrorStatus(error);
    return NextResponse.json(
      {
        error:
          status === 500
            ? "Secure practice access could not be verified"
            : error?.message || "Secure practice access was rejected",
      },
      { status, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
