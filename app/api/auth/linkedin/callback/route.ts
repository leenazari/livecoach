import { NextRequest, NextResponse } from "next/server";
import {
  exchangeLinkedInCode,
  fetchLinkedInUserInfo,
  LINKEDIN_IDENTITY_SCOPES,
  saveLinkedInConnection,
} from "@/lib/linkedin";
import { getRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";

const clearOAuthCookies = (response: NextResponse) => {
  response.cookies.set("linkedin_oauth_state", "", { maxAge: 0, path: "/" });
  response.cookies.set("linkedin_oauth_owner", "", { maxAge: 0, path: "/" });
  return response;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}`;
  const resultUrl = (value: string) => `${base}/settings?linkedin=${value}`;
  const scope = getRequestScope();
  if (!scope) {
    return clearOAuthCookies(NextResponse.redirect(resultUrl("error")));
  }
  if (url.searchParams.get("error")) {
    return clearOAuthCookies(NextResponse.redirect(resultUrl("denied")));
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.cookies.get("linkedin_oauth_state")?.value;
  const cookieOwner = request.cookies.get("linkedin_oauth_owner")?.value;
  if (
    !code ||
    !state ||
    !cookieState ||
    state !== cookieState ||
    cookieOwner !== scope.userId
  ) {
    return clearOAuthCookies(NextResponse.redirect(resultUrl("error")));
  }

  try {
    const token = await exchangeLinkedInCode(code);
    const accessToken = String(token.access_token || "").trim();
    if (!accessToken) throw new Error("LinkedIn did not return an access token");
    const profile = await fetchLinkedInUserInfo(accessToken);
    const memberId = String(profile.sub || "").trim();
    if (!memberId) {
      return clearOAuthCookies(
        NextResponse.redirect(resultUrl("identity_missing"))
      );
    }

    const { data: duplicate, error: duplicateError } = await supabaseService
      .from("linkedin_oauth")
      .select("owner_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("member_id", memberId)
      .neq("owner_id", scope.userId)
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate?.owner_id) {
      return clearOAuthCookies(
        NextResponse.redirect(resultUrl("account_in_use"))
      );
    }

    const grantedScopes = String(
      token.scope || LINKEDIN_IDENTITY_SCOPES.join(" ")
    )
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    await saveLinkedInConnection({
      accessToken,
      refreshToken: token.refresh_token ? String(token.refresh_token) : null,
      expiry: new Date(
        Date.now() + Number(token.expires_in || 5184000) * 1000
      ).toISOString(),
      memberId,
      email: typeof profile.email === "string" ? profile.email : null,
      displayName: typeof profile.name === "string" ? profile.name : null,
      pictureUrl: typeof profile.picture === "string" ? profile.picture : null,
      scopes: grantedScopes,
    });

    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        source: "human",
        action: "linkedin_connector_connected",
        target_table: "linkedin_oauth",
        target_id: scope.userId,
        previous_scope: null,
        next_scope: {
          connected: true,
          social_access: grantedScopes.includes("w_member_social"),
        },
      });
    if (auditError) {
      console.error("LinkedIn connect audit failed", auditError.message);
    }

    return clearOAuthCookies(
      NextResponse.redirect(
        resultUrl(
          grantedScopes.includes("w_member_social")
            ? "social_enabled"
            : "connected"
        )
      )
    );
  } catch (error: any) {
    console.error("LinkedIn OAuth callback failed", error?.message || error);
    return clearOAuthCookies(NextResponse.redirect(resultUrl("error")));
  }
}
