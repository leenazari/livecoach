import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import {
  principalFromAuthInfo,
  staffMcpResourceUrl,
  verifyStaffMcpAccessToken,
} from "@/lib/staff-mcp-auth";
import { buildStaffMcpServer } from "@/lib/staff-mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mcpHandler = createMcpHandler(
  ({ authInfo }) => buildStaffMcpServer(principalFromAuthInfo(authInfo)),
  {
    responseMode: "json",
    onerror(error) {
      console.error("LiveCoach staff MCP request failed", error);
    },
  }
);

const requireMcpUser = requireBearerAuth({
  verifier: { verifyAccessToken: verifyStaffMcpAccessToken },
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(staffMcpResourceUrl()),
});

function configuredHostname(value: string | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
}

function allowedHostnames(): string[] {
  return [
    staffMcpResourceUrl().hostname,
    "livecoachcrm.com",
    "www.livecoachcrm.com",
    configuredHostname(process.env.VERCEL_URL),
    configuredHostname(process.env.VERCEL_BRANCH_URL),
    configuredHostname(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    ...localhostAllowedHostnames(),
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
}

function allowedOriginHostnames(): string[] {
  return [
    ...allowedHostnames(),
    "chatgpt.com",
    "chat.openai.com",
    "openai.com",
    ...localhostAllowedOrigins(),
  ].filter((value, index, all) => all.indexOf(value) === index);
}

function addHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serve(request: Request): Promise<Response> {
  const rejected =
    hostHeaderValidationResponse(request, allowedHostnames()) ||
    originValidationResponse(request, allowedOriginHostnames());
  if (rejected) return addHeaders(rejected);

  const authInfo = await requireMcpUser(request);
  if (authInfo instanceof Response) return addHeaders(authInfo);
  return addHeaders(await mcpHandler.fetch(request, { authInfo }));
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers":
        "authorization,content-type,mcp-protocol-version,mcp-session-id",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "mcp-session-id,www-authenticate",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
