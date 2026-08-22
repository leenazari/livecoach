import { NextRequest, NextResponse } from "next/server";
import { createLiveKitToken } from "@/lib/livekit";
import { getRequestScope } from "@/lib/request-scope";
import {
  authorizeCandidateRoom,
  claimLiveKitRoom,
  enforceAnonymousRealtimeAttempt,
  enforceRealtimeRateLimit,
  hasCandidateSessionCookie,
  RealtimeAccessError,
  realtimeErrorStatus,
  recordRealtimeEvent,
  safeParticipantName,
  setCandidateSessionCookie,
} from "@/lib/realtime-token-security";
import { validMeetSessionId } from "@/lib/transcriber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff access is established by middleware and always receives an
// interviewer role. Public candidate access requires the single-use invite or
// the short-lived HttpOnly session created when that invite was redeemed. A
// browser-supplied role is deliberately ignored.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const room = typeof body?.room === "string" ? body.room : "";
    if (!validMeetSessionId(room)) {
      return NextResponse.json(
        { error: "A valid LiveCoach call room is required" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const inviteToken = body?.inviteToken;
    const candidateCredentialPresented =
      typeof inviteToken === "string" ||
      (body?.candidateSession === true && hasCandidateSessionCookie(req));

    if (candidateCredentialPresented) {
      await enforceAnonymousRealtimeAttempt(req, "livekit_candidate_access");
      const candidate = await authorizeCandidateRoom(req, room, inviteToken);
      await enforceRealtimeRateLimit({
        workspaceId: candidate.invite.workspace_id,
        actorUserId: null,
        action: "livekit_candidate_token_granted",
        targetId: candidate.invite.id,
        limit: 8,
        windowMs: 60 * 1000,
      });
      const token = await createLiveKitToken({
        room,
        identity: `candidate-${candidate.invite.id}`,
        displayName: safeParticipantName(body?.identity, "Candidate"),
        role: "candidate",
      });
      await recordRealtimeEvent({
        workspaceId: candidate.invite.workspace_id,
        actorUserId: null,
        action: "livekit_candidate_token_granted",
        targetTable: "livekit_join_invites",
        targetId: candidate.invite.id,
        metadata: { room_id: room, role: "candidate" },
      });

      const response = NextResponse.json(
        { token, url: process.env.NEXT_PUBLIC_LIVEKIT_URL, role: "candidate" },
        { headers: { "Cache-Control": "private, no-store" } }
      );
      if (candidate.newSessionSecret) {
        setCandidateSessionCookie(
          response,
          candidate.newSessionSecret,
          candidate.invite.candidate_session_expires_at
        );
      }
      return response;
    }

    const scope = getRequestScope();
    if (!scope || scope.status !== "active") {
      throw new RealtimeAccessError("Active workspace access is required", 401);
    }
    await claimLiveKitRoom(scope, room);
    await enforceRealtimeRateLimit({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "livekit_interviewer_token_granted",
      limit: 12,
      windowMs: 60 * 1000,
    });
    const token = await createLiveKitToken({
      room,
      identity: `interviewer-${scope.userId}`,
      displayName: safeParticipantName(body?.identity, "Interviewer"),
      role: "interviewer",
    });
    await recordRealtimeEvent({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "livekit_interviewer_token_granted",
      targetTable: "livekit_rooms",
      targetId: room,
      metadata: { role: "interviewer" },
    });

    return NextResponse.json({
      token,
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
      role: "interviewer",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    const status = realtimeErrorStatus(error);
    console.error("LiveKit token request rejected", {
      status,
      message: error?.message || "unknown error",
    });
    return NextResponse.json(
      {
        error:
          status === 500
            ? "Secure LiveKit access could not be verified"
            : error?.message || "Secure LiveKit access was rejected",
      },
      { status, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
