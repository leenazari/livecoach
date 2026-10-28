import "server-only";

import {
  chatGptPluginMcpResourceUrl,
  staffMcpDiscoveryUrl,
  staffMcpIssuer,
  staffMcpResourceUrl,
} from "@/lib/staff-mcp-auth";

export const STAFF_MCP_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
] as const;

function protectedResourceMetadata(input: {
  resource: URL;
  name: string;
}) {
  return {
    resource: input.resource.href,
    authorization_servers: [staffMcpIssuer()],
    scopes_supported: [...STAFF_MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: input.name,
    resource_documentation: `${input.resource.origin}/settings#chatgpt-mcp`,
  };
}

export function staffMcpProtectedResourceMetadata() {
  return protectedResourceMetadata({
    resource: staffMcpResourceUrl(),
    name: "LiveCoach Staff CRM",
  });
}

export function chatGptPluginMcpProtectedResourceMetadata() {
  return protectedResourceMetadata({
    resource: chatGptPluginMcpResourceUrl(),
    name: "LiveCoach CRM for ChatGPT",
  });
}

export async function staffMcpAuthorizationServerMetadata(): Promise<Record<string, unknown>> {
  const response = await fetch(staffMcpDiscoveryUrl(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Supabase OAuth server metadata is unavailable");
  }
  const metadata = (await response.json()) as Record<string, unknown>;
  if (
    String(metadata.issuer || "").replace(/\/$/, "") !==
      staffMcpIssuer().replace(/\/$/, "") ||
    typeof metadata.authorization_endpoint !== "string" ||
    typeof metadata.token_endpoint !== "string"
  ) {
    throw new Error("Supabase OAuth server metadata is invalid");
  }
  return metadata;
}

export function oauthMetadataResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function oauthOptionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
