import "server-only";

import { createHash, randomBytes } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { RequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { validMeetSessionId } from "@/lib/transcriber";

export const CANDIDATE_SESSION_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-livecoach_candidate"
    : "livecoach_candidate";

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SECRET = /^[A-Za-z0-9_-]{40,96}$/;

type CandidateInviteRow = {
  id: string;
  workspace_id: string;
  owner_id: string;
  room_id: string;
  candidate_session_expires_at: string | null;
};

type RoomScope = Pick<RequestScope, "workspaceId" | "userId">;

export class RealtimeAccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "RealtimeAccessError";
    this.status = status;
  }
}

export function realtimeErrorStatus(error: unknown) {
  return error instanceof RealtimeAccessError ? error.status : 500;
}

export function hashRealtimeSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function newRealtimeSecret() {
  return randomBytes(32).toString("base64url");
}

export function safeParticipantName(value: unknown, fallback: string) {
  const clean = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

export async function claimLiveKitRoom(scope: RoomScope, roomId: string) {
  if (!validMeetSessionId(roomId)) {
    throw new RealtimeAccessError(
      "A valid LiveCoach call room is required",
      400
    );
  }

  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabaseService
    .from("livekit_rooms")
    .select("room_id,workspace_id,owner_id,revoked_at")
    .eq("room_id", roomId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    if (
      existing.workspace_id !== scope.workspaceId ||
      existing.owner_id !== scope.userId
    ) {
      throw new RealtimeAccessError(
        "This call room belongs to a different account",
        403
      );
    }
    if (existing.revoked_at) {
      throw new RealtimeAccessError("This call room has ended", 410);
    }
    const { error: touchError } = await supabaseService
      .from("livekit_rooms")
      .update({ last_used_at: now, updated_at: now })
      .eq("room_id", roomId)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .is("revoked_at", null);
    if (touchError) throw touchError;
    return;
  }

  const { error: insertError } = await supabaseService
    .from("livekit_rooms")
    .insert({
      room_id: roomId,
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      last_used_at: now,
      updated_at: now,
    });
  if (!insertError) return;

  // A simultaneous first request can lose the unique-key race. Re-read the
  // winner and allow it only when the immutable workspace binding is ours.
  if (insertError.code === "23505") {
    const { data: winner, error: winnerError } = await supabaseService
      .from("livekit_rooms")
      .select("workspace_id,owner_id,revoked_at")
      .eq("room_id", roomId)
      .single();
    if (winnerError) throw winnerError;
    if (
      winner.workspace_id === scope.workspaceId &&
      winner.owner_id === scope.userId &&
      !winner.revoked_at
    ) {
      return;
    }
    throw new RealtimeAccessError(
      "This call room belongs to a different account",
      403
    );
  }
  throw insertError;
}

export async function createCandidateInvite(
  scope: Pick<RequestScope, "workspaceId" | "userId">,
  roomId: string
) {
  if (!validMeetSessionId(roomId)) {
    throw new RealtimeAccessError(
      "A valid LiveCoach call room is required",
      400
    );
  }

  await claimLiveKitRoom(scope, roomId);

  await enforceRealtimeRateLimit({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "livekit_candidate_invite_created",
    limit: 12,
    windowMs: 60 * 60 * 1000,
  });

  const rawToken = newRealtimeSecret();
  const tokenHash = hashRealtimeSecret(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const { data, error } = await supabaseService
    .from("livekit_join_invites")
    .upsert(
      {
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        room_id: roomId,
        invite_token_hash: tokenHash,
        candidate_session_hash: null,
        expires_at: expiresAt.toISOString(),
        redeemed_at: null,
        candidate_session_expires_at: null,
        revoked_at: null,
        last_used_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "owner_id,room_id" }
    )
    .select("id,workspace_id,owner_id,room_id")
    .single();
  if (error) throw error;

  await recordRealtimeEvent({
    workspaceId: scope.workspaceId,
    actorUserId: scope.userId,
    action: "livekit_candidate_invite_created",
    targetTable: "livekit_join_invites",
    targetId: data.id,
    metadata: {
      room_id: roomId,
      expires_at: expiresAt.toISOString(),
      single_use: true,
    },
  });

  return { rawToken, expiresAt: expiresAt.toISOString(), inviteId: data.id };
}

async function candidateSessionFromCookie(
  req: NextRequest,
  roomId?: string
): Promise<CandidateInviteRow | null> {
  const rawSession = req.cookies.get(CANDIDATE_SESSION_COOKIE)?.value || "";
  if (!SECRET.test(rawSession)) return null;

  let query = supabaseService
    .from("livekit_join_invites")
    .select(
      "id,workspace_id,owner_id,room_id,candidate_session_expires_at"
    )
    .eq("candidate_session_hash", hashRealtimeSecret(rawSession))
    .is("revoked_at", null)
    .gt("candidate_session_expires_at", new Date().toISOString());
  if (roomId) query = query.eq("room_id", roomId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return (data as CandidateInviteRow | null) || null;
}

export function hasCandidateSessionCookie(req: NextRequest) {
  return Boolean(req.cookies.get(CANDIDATE_SESSION_COOKIE)?.value);
}

export async function getCandidateSession(req: NextRequest) {
  return candidateSessionFromCookie(req);
}

export async function authorizeCandidateRoom(
  req: NextRequest,
  roomId: string,
  inviteToken: unknown
): Promise<{
  invite: CandidateInviteRow;
  newSessionSecret: string | null;
}> {
  if (!validMeetSessionId(roomId)) {
    throw new RealtimeAccessError(
      "A valid LiveCoach call room is required",
      400
    );
  }

  const existing = await candidateSessionFromCookie(req, roomId);
  if (existing) return { invite: existing, newSessionSecret: null };

  const rawInvite = typeof inviteToken === "string" ? inviteToken : "";
  if (!SECRET.test(rawInvite)) {
    throw new RealtimeAccessError(
      "This secure call invitation is missing or invalid",
      401
    );
  }

  const now = new Date();
  const rawSession = newRealtimeSecret();
  const sessionExpiresAt = new Date(
    now.getTime() + CANDIDATE_SESSION_TTL_MS
  );
  const { data, error } = await supabaseService
    .from("livekit_join_invites")
    .update({
      candidate_session_hash: hashRealtimeSecret(rawSession),
      candidate_session_expires_at: sessionExpiresAt.toISOString(),
      redeemed_at: now.toISOString(),
      last_used_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("room_id", roomId)
    .eq("invite_token_hash", hashRealtimeSecret(rawInvite))
    .is("redeemed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .select(
      "id,workspace_id,owner_id,room_id,candidate_session_expires_at"
    )
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new RealtimeAccessError(
      "This secure call invitation has expired or was already used",
      403
    );
  }

  return {
    invite: data as CandidateInviteRow,
    newSessionSecret: rawSession,
  };
}

export function setCandidateSessionCookie(
  response: NextResponse,
  secret: string,
  expiresAt: string | null
) {
  const expires = expiresAt ? new Date(expiresAt) : new Date(Date.now() + CANDIDATE_SESSION_TTL_MS);
  response.cookies.set(CANDIDATE_SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires,
  });
}

export async function enforceRealtimeRateLimit(options: {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetId?: string;
  limit: number;
  windowMs: number;
}) {
  const subject = options.actorUserId || options.targetId;
  if (!subject) {
    throw new RealtimeAccessError("A secure rate-limit subject is required", 500);
  }
  const keyHash = hashRealtimeSecret(
    [options.workspaceId, options.action, subject].join(":")
  );
  const { data, error } = await supabaseService.rpc(
    "consume_realtime_token_rate_limit",
    {
      p_key_hash: keyHash,
      p_limit: options.limit,
      p_window_seconds: Math.max(1, Math.ceil(options.windowMs / 1000)),
    }
  );
  if (error) throw error;
  if (data !== true) {
    throw new RealtimeAccessError(
      "Too many secure token requests. Wait a moment and try again",
      429
    );
  }
}

export async function enforceAnonymousRealtimeAttempt(
  req: NextRequest,
  action: string,
  limit = 30
) {
  const forwardedFor = String(req.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    .trim()
    .slice(0, 80);
  const connectingIp = String(req.headers.get("x-real-ip") || "")
    .trim()
    .slice(0, 80);
  const userAgent = String(req.headers.get("user-agent") || "")
    .trim()
    .slice(0, 160);
  const subject = forwardedFor || connectingIp || "unknown-network";
  const keyHash = hashRealtimeSecret(
    ["public", action, subject, userAgent].join(":")
  );
  const { data, error } = await supabaseService.rpc(
    "consume_realtime_token_rate_limit",
    {
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: 60,
    }
  );
  if (error) throw error;
  if (data !== true) {
    throw new RealtimeAccessError(
      "Too many secure access attempts. Wait a moment and try again",
      429
    );
  }
}

export async function recordRealtimeEvent(options: {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetTable: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabaseService.from("access_audit_events").insert({
    workspace_id: options.workspaceId,
    actor_user_id: options.actorUserId,
    source: options.actorUserId ? "human" : "system",
    action: options.action,
    target_table: options.targetTable,
    target_id: options.targetId,
    metadata: options.metadata || {},
  });
  if (error) throw error;
}
