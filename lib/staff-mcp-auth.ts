import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { publicAppOrigin } from "@/lib/public-app-url";

export type StaffMcpRole = "owner" | "manager" | "sales";

export type StaffMcpPrincipal = {
  userId: string;
  workspaceId: string;
  role: StaffMcpRole;
  clientId: string;
  accessToken: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function databaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, cache: "no-store" });
}

function requiredEnvironment(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function staffMcpResourceUrl(): URL {
  const configured = String(process.env.LIVECOACH_MCP_RESOURCE_URL || "").trim();
  const url = new URL(configured || "/mcp", publicAppOrigin());
  url.hash = "";
  return url;
}

export function staffMcpIssuer(): string {
  return `${requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "")}/auth/v1`;
}

export function staffMcpDiscoveryUrl(): string {
  const base = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  return `${base}/.well-known/oauth-authorization-server/auth/v1`;
}

export function createStaffMcpClient(accessToken: string): SupabaseClient {
  return createClient(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: databaseFetch,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    }
  );
}

function claimScopes(claims: Record<string, unknown>): string[] {
  const raw = claims.scope ?? claims.scopes;
  if (typeof raw === "string") {
    return [...new Set(raw.split(/\s+/).map((value) => value.trim()).filter(Boolean))];
  }
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw.map((value) => String(value || "").trim()).filter(Boolean)
      ),
    ];
  }
  return [];
}

function audienceIncludesAuthenticated(audience: unknown): boolean {
  if (audience === "authenticated") return true;
  return Array.isArray(audience) && audience.includes("authenticated");
}

function configuredClientIds(): Set<string> {
  return new Set(
    String(process.env.LIVECOACH_MCP_ALLOWED_CLIENT_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function invalidToken(message: string): never {
  throw new OAuthError(OAuthErrorCode.InvalidToken, message);
}

export async function verifyStaffMcpAccessToken(
  accessToken: string
): Promise<AuthInfo> {
  const supabase = createStaffMcpClient(accessToken);
  const [{ data: claimData, error: claimError }, { data: userData, error: userError }] =
    await Promise.all([
      supabase.auth.getClaims(accessToken),
      supabase.auth.getUser(accessToken),
    ]);

  if (claimError || !claimData?.claims || userError || !userData.user) {
    invalidToken("The LiveCoach connection has expired or was revoked");
  }

  const claims = claimData.claims as Record<string, unknown>;
  const userId = String(claims.sub || "");
  const clientId = String(claims.client_id || "");
  const issuer = String(claims.iss || "");
  const expiresAt = Number(claims.exp || 0);

  if (!UUID.test(userId) || userData.user.id !== userId) {
    invalidToken("The LiveCoach connection does not identify a valid user");
  }
  if (!UUID.test(clientId)) {
    invalidToken("This is not a LiveCoach OAuth connection");
  }
  if (issuer.replace(/\/$/, "") !== staffMcpIssuer()) {
    invalidToken("The LiveCoach connection was issued by the wrong authority");
  }
  if (!audienceIncludesAuthenticated(claims.aud)) {
    invalidToken("The LiveCoach connection has the wrong audience");
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    invalidToken("The LiveCoach connection has expired");
  }

  const allowedClientIds = configuredClientIds();
  if (allowedClientIds.size && !allowedClientIds.has(clientId)) {
    invalidToken("This OAuth client is not approved for the LiveCoach staff connector");
  }

  const tokenResource = String(claims.resource || claims.resource_server || "").trim();
  if (tokenResource && tokenResource !== staffMcpResourceUrl().href) {
    invalidToken("The LiveCoach connection was issued for a different resource");
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id,role,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(2);

  if (membershipError || !memberships?.length) {
    invalidToken("This LiveCoach user does not have active workspace access");
  }
  if (memberships.length !== 1) {
    invalidToken("LiveCoach could not safely identify one workspace for this user");
  }

  const membership = memberships[0] as Record<string, unknown>;
  const workspaceId = String(membership.workspace_id || "");
  const role = String(membership.role || "");
  if (!UUID.test(workspaceId) || !["owner", "manager", "sales"].includes(role)) {
    invalidToken("This LiveCoach workspace membership is not valid");
  }

  const scopes = claimScopes(claims);
  return {
    token: accessToken,
    clientId,
    scopes,
    expiresAt,
    resource: staffMcpResourceUrl(),
    extra: {
      userId,
      workspaceId,
      role,
    },
  };
}

export function principalFromAuthInfo(authInfo: AuthInfo | undefined): StaffMcpPrincipal {
  const userId = String(authInfo?.extra?.userId || "");
  const workspaceId = String(authInfo?.extra?.workspaceId || "");
  const role = String(authInfo?.extra?.role || "");
  const clientId = String(authInfo?.clientId || "");
  const accessToken = String(authInfo?.token || "");
  if (
    !UUID.test(userId) ||
    !UUID.test(workspaceId) ||
    !UUID.test(clientId) ||
    !accessToken ||
    !["owner", "manager", "sales"].includes(role)
  ) {
    invalidToken("Verified LiveCoach staff context is required");
  }
  return {
    userId,
    workspaceId,
    role: role as StaffMcpRole,
    clientId,
    accessToken,
  };
}
