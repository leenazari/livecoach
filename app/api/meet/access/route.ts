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
    let teamHints: string[] = [];
    const { data: teammates, error: teammateError } = await supabaseService
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("status", "active")
      .neq("user_id", scope.userId);
    if (teammateError) throw teammateError;
    const teammateIds = (teammates || []).map((member) => member.user_id);
    if (teammateIds.length) {
      const { data: teammateProfiles, error: profileError } = await supabaseService
        .from("profiles")
        .select("display_name,transcriber_aliases")
        .in("user_id", teammateIds);
      if (profileError) throw profileError;
      const hints = new Map<string, string>();
      const addHint = (value: unknown) => {
        const clean = String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (clean) hints.set(clean.toLowerCase(), clean);
      };
      for (const profile of teammateProfiles || []) {
        const displayName = String(profile.display_name || "").trim();
        addHint(displayName);
        if (Array.isArray(profile.transcriber_aliases)) {
          // Avoid classifying an external guest as internal merely because
          // they share a common first name with any workspace member. A
          // single-name profile can still use its one exact name.
          const singleNameProfile = displayName.split(/\s+/).length === 1;
          profile.transcriber_aliases
            .filter(
              (alias: unknown) =>
                singleNameProfile || String(alias || "").trim().includes(" ")
            )
            .forEach(addHint);
        }
      }
      teamHints = Array.from(hints.values()).slice(0, 36);
    }
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
        teamHints,
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
