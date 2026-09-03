import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveGoogleConnectionForOwner } from "@/lib/google";
import { verifyGoogleOAuthState } from "@/lib/google-oauth-state";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/auth/google/callback -> Google redirects here with a code. Verify the
// state cookie, exchange the code for tokens, store them, and bounce back to
// Settings with a status flag.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthState = verifyGoogleOAuthState(state);
  const fallbackOrigin = "https://www.livecoachcrm.com";
  const returnOrigin = oauthState?.returnOrigin || fallbackOrigin;
  const cookieState = req.cookies.get("g_oauth_state")?.value;
  const destination = oauthState?.onboarding ? "/join-team" : "/settings";
  const resultUrl = (value: string) =>
    `${returnOrigin}${destination}?google=${value}${
      value === "connected" ? "&calendar=sync" : ""
    }`;
  const clearState = (response: NextResponse) => {
    response.cookies.set("g_oauth_state", "", { maxAge: 0, path: "/" });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };

  if (url.searchParams.get("error")) {
    return clearState(NextResponse.redirect(resultUrl("denied")));
  }
  if (!oauthState || !code || (cookieState && state !== cookieState)) {
    return clearState(NextResponse.redirect(resultUrl("error")));
  }

  try {
    const { data: membership, error: membershipError } = await supabaseService
      .from("workspace_members")
      .select("role,status")
      .eq("workspace_id", oauthState.workspaceId)
      .eq("user_id", oauthState.userId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !["active", "onboarding"].includes(membership.status)) {
      return clearState(NextResponse.redirect(resultUrl("access_denied")));
    }

    const tok = await exchangeCode(code);
    const access = tok.access_token as string | undefined;
    const refresh = tok.refresh_token as string | undefined;
    const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();

    // Best-effort: which account did they connect.
    let email: string | null = null;
    if (access) {
      try {
        const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (r.ok) email = (await r.json())?.email || null;
      } catch {
        /* ignore */
      }
    }

    if (membership.role !== "owner" && !email) {
      return clearState(NextResponse.redirect(resultUrl("identity_missing")));
    }
    if (email) {
      const { data: duplicate, error: duplicateError } = await supabaseService
        .from("google_oauth")
        .select("owner_id")
        .eq("workspace_id", oauthState.workspaceId)
        .neq("owner_id", oauthState.userId)
        .ilike("email", email.trim().toLowerCase())
        .limit(1)
        .maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate?.owner_id) {
        return clearState(NextResponse.redirect(resultUrl("account_in_use")));
      }
    }

    // Credentials are stored only against the signed-in LiveCoach account.
    // A refresh token omitted by Google leaves that person's existing token in
    // place and can never overwrite another member's connection.
    await saveGoogleConnectionForOwner(
      {
        accessToken: access || null,
        refreshToken: refresh || null,
        expiry,
        email,
      },
      {
        userId: oauthState.userId,
        workspaceId: oauthState.workspaceId,
      }
    );

    // Active team members can connect Google after their account has already
    // been activated. Bootstrap the verified outreach identity at that point
    // so the database can prove that future drafts belong to this mailbox.
    // Never overwrite an existing sender because owners may intentionally use
    // a verified Gmail send-as alias.
    if (membership.status === "active" && email) {
      const normalizedEmail = email.trim().toLowerCase();
      const { data: senderProfile, error: senderReadError } = await supabaseService
        .from("profiles")
        .select("display_name,outreach_sender_name,outreach_sender_email")
        .eq("user_id", oauthState.userId)
        .maybeSingle();
      if (senderReadError) throw senderReadError;
      if (!senderProfile) throw new Error("LiveCoach account profile is unavailable");

      if (!senderProfile.outreach_sender_email) {
        const { error: senderUpdateError } = await supabaseService
          .from("profiles")
          .update({
            outreach_sender_name:
              senderProfile.outreach_sender_name ||
              senderProfile.display_name ||
              normalizedEmail,
            outreach_sender_email: normalizedEmail,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", oauthState.userId)
          .is("outreach_sender_email", null);
        if (senderUpdateError) throw senderUpdateError;
      }
    }

    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: oauthState.workspaceId,
        actor_user_id: oauthState.userId,
        source: "human",
        action: "google_connector_connected",
        target_table: "google_oauth",
        target_id: oauthState.userId,
        previous_scope: null,
        next_scope: { connected: true },
      });
    if (auditError) {
      console.error("Google connect audit failed", auditError.message);
    }

    return clearState(NextResponse.redirect(resultUrl("connected")));
  } catch (error: any) {
    console.error("Google OAuth callback failed", error?.message || error);
    return clearState(NextResponse.redirect(resultUrl("error")));
  }
}
