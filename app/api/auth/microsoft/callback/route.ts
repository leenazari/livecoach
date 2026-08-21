import { NextRequest, NextResponse } from "next/server";
import {
  exchangeMicrosoftCode,
  MICROSOFT_SCOPES,
  saveMicrosoftConnection,
} from "@/lib/microsoft";
import { getRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";

const clearState = (response: NextResponse) => {
  response.cookies.set("ms_oauth_state", "", { maxAge: 0, path: "/" });
  return response;
};

const tokenClaim = (token: unknown, claim: string): string | null => {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded?.[claim] === "string" ? decoded[claim] : null;
  } catch {
    return null;
  }
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const scope = getRequestScope();
  const onboarding = scope?.status === "onboarding";
  const destination = onboarding ? "/join-team" : "/settings";
  const resultUrl = (value: string) => `${base}${destination}?microsoft=${value}`;
  if (!scope) return clearState(NextResponse.redirect(resultUrl("error")));
  if (url.searchParams.get("error")) {
    return clearState(NextResponse.redirect(resultUrl("denied")));
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("ms_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return clearState(NextResponse.redirect(resultUrl("error")));
  }

  try {
    const token = await exchangeMicrosoftCode(code);
    const accessToken = String(token.access_token || "");
    const refreshToken = String(token.refresh_token || "");
    if (!accessToken || !refreshToken) throw new Error("Microsoft did not return offline access");
    const profileResponse = await fetch(
      "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    if (!profileResponse.ok) throw new Error("Microsoft account identity is unavailable");
    const profile = await profileResponse.json();
    const email = String(profile.mail || profile.userPrincipalName || "")
      .trim()
      .toLowerCase();
    const accountId = String(profile.id || "").trim();
    if (!email || !accountId) {
      return clearState(NextResponse.redirect(resultUrl("identity_missing")));
    }

    const { data: duplicate, error: duplicateError } = await supabaseService
      .from("microsoft_oauth")
      .select("owner_id")
      .eq("workspace_id", scope.workspaceId)
      .neq("owner_id", scope.userId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate?.owner_id) {
      return clearState(NextResponse.redirect(resultUrl("account_in_use")));
    }

    const grantedScopes = String(token.scope || MICROSOFT_SCOPES.join(" "))
      .split(/\s+/)
      .filter(Boolean);
    await saveMicrosoftConnection({
      accessToken,
      refreshToken,
      expiry: new Date(
        Date.now() + Number(token.expires_in || 3600) * 1000
      ).toISOString(),
      email,
      accountId,
      tenantId: tokenClaim(token.id_token, "tid"),
      scopes: grantedScopes,
    });

    const { data: member, error: memberError } = await supabaseService
      .from("workspace_members")
      .select("status")
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", scope.userId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (member?.status === "active") {
      const { data: existingSender, error: senderReadError } = await supabaseService
        .from("profiles")
        .select("display_name,outreach_sender_email")
        .eq("user_id", scope.userId)
        .maybeSingle();
      if (senderReadError) throw senderReadError;
      if (!existingSender?.outreach_sender_email) {
        const { error: senderUpdateError } = await supabaseService
          .from("profiles")
          .update({
            outreach_sender_name: existingSender?.display_name || profile.displayName || email,
            outreach_sender_email: email,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", scope.userId);
        if (senderUpdateError) throw senderUpdateError;
      }
    }

    return clearState(NextResponse.redirect(resultUrl("connected")));
  } catch (error: any) {
    console.error("Microsoft OAuth callback failed", error?.message || error);
    return clearState(NextResponse.redirect(resultUrl("error")));
  }
}
