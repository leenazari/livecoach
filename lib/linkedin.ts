import "server-only";

import { getRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

const AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export const LINKEDIN_IDENTITY_SCOPES = ["openid", "profile", "email"];
export const LINKEDIN_SOCIAL_SCOPE = "w_member_social";

type LinkedInConnection = {
  id: string;
  workspace_id: string;
  owner_id: string;
  member_id: string | null;
  email: string | null;
  display_name: string | null;
  picture_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expiry: string | null;
  scopes: string[] | null;
};

export type LinkedInUserInfo = {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
};

export function linkedinConfigured(): boolean {
  return !!(
    process.env.LINKEDIN_CLIENT_ID &&
    process.env.LINKEDIN_CLIENT_SECRET &&
    process.env.LINKEDIN_REDIRECT_URI
  );
}

export function linkedInScopes(includeSocial: boolean): string[] {
  return includeSocial
    ? [...LINKEDIN_IDENTITY_SCOPES, LINKEDIN_SOCIAL_SCOPE]
    : [...LINKEDIN_IDENTITY_SCOPES];
}

export function buildLinkedInAuthUrl(
  state: string,
  includeSocial = false
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI || "",
    state,
    scope: linkedInScopes(includeSocial).join(" "),
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeLinkedInCode(code: string): Promise<any> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.LINKEDIN_CLIENT_ID || "",
    client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI || "",
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`LinkedIn token exchange failed (${response.status})`);
  }
  return response.json();
}

export async function fetchLinkedInUserInfo(
  accessToken: string
): Promise<LinkedInUserInfo> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`LinkedIn identity lookup failed (${response.status})`);
  }
  return response.json();
}

async function connectionForOwner(
  ownerId?: string
): Promise<LinkedInConnection | null> {
  const scope = getRequestScope();
  if (!scope) throw new Error("A verified account is required for LinkedIn access");
  if (ownerId && ownerId !== scope.userId) {
    throw new Error("Cross-account LinkedIn access is not permitted");
  }
  const exactOwner = ownerId || scope.userId;
  const { data, error } = await supabaseService
    .from("linkedin_oauth")
    .select(
      "id,workspace_id,owner_id,member_id,email,display_name,picture_url,access_token,refresh_token,expiry,scopes"
    )
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", exactOwner)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as LinkedInConnection | null) || null;
}

export async function saveLinkedInConnection(input: {
  accessToken: string;
  refreshToken?: string | null;
  expiry: string;
  memberId: string;
  email?: string | null;
  displayName?: string | null;
  pictureUrl?: string | null;
  scopes: string[];
}): Promise<void> {
  const scope = getRequestScope();
  if (!scope) throw new Error("A verified account is required to connect LinkedIn");
  const existing = await connectionForOwner(scope.userId);
  const row: Record<string, unknown> = {
    id: existing?.id || `user:${scope.userId}`,
    workspace_id: scope.workspaceId,
    owner_id: scope.userId,
    visibility: "private",
    member_id: input.memberId,
    email: input.email?.trim().toLowerCase() || null,
    display_name: input.displayName?.trim() || null,
    picture_url: input.pictureUrl?.trim() || null,
    access_token: input.accessToken,
    refresh_token: input.refreshToken || null,
    expiry: input.expiry,
    scopes: input.scopes,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseService
    .from("linkedin_oauth")
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function linkedinAccessStatus(): Promise<{
  status: "ok" | "expired" | "disconnected";
  connected: boolean;
  email: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  socialAccess: boolean;
  expiresAt: string | null;
}> {
  const connection = await connectionForOwner();
  if (!connection?.access_token) {
    return {
      status: "disconnected",
      connected: false,
      email: null,
      displayName: null,
      pictureUrl: null,
      socialAccess: false,
      expiresAt: null,
    };
  }
  const scopes = new Set(
    (connection.scopes || []).map((value) => String(value).toLowerCase())
  );
  const expired =
    !connection.expiry || new Date(connection.expiry).getTime() <= Date.now();
  return {
    status: expired ? "expired" : "ok",
    connected: !expired,
    email: connection.email,
    displayName: connection.display_name,
    pictureUrl: connection.picture_url,
    socialAccess: scopes.has(LINKEDIN_SOCIAL_SCOPE),
    expiresAt: connection.expiry,
  };
}

export async function disconnectLinkedInConnection(): Promise<{
  disconnected: boolean;
  email: string | null;
  displayName: string | null;
}> {
  const scope = getRequestScope();
  if (!scope) throw new Error("A verified account is required to disconnect LinkedIn");
  const existing = await connectionForOwner(scope.userId);
  if (!existing) {
    return { disconnected: false, email: null, displayName: null };
  }
  const { data, error } = await supabaseService
    .from("linkedin_oauth")
    .delete()
    .eq("id", existing.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("LinkedIn disconnect was not confirmed");
  return {
    disconnected: !!existing.access_token,
    email: existing.email,
    displayName: existing.display_name,
  };
}
