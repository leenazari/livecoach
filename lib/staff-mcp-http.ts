import "server-only";

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
  verifyStaffMcpAccessToken,
  type StaffConnectorClientType,
} from "@/lib/staff-mcp-auth";
import {
  buildStaffMcpServer,
  type StaffMcpServerOptions,
} from "@/lib/staff-mcp-tools";

type StaffMcpHttpRouteOptions = {
  clientType: StaffConnectorClientType;
  resourceUrl: () => URL;
  logLabel: string;
  serverOptions?: StaffMcpServerOptions;
};

function configuredHostname(value: string | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
}

function uniqueHostnames(values: Array<string | null>): string[] {
  return values.filter(
    (value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index
  );
}

function allowedHostnames(resourceUrl: URL): string[] {
  return uniqueHostnames([
    resourceUrl.hostname,
    "livecoachcrm.com",
    "www.livecoachcrm.com",
    configuredHostname(process.env.VERCEL_URL),
    configuredHostname(process.env.VERCEL_BRANCH_URL),
    configuredHostname(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    ...localhostAllowedHostnames(),
  ]);
}

function allowedOriginHostnames(resourceUrl: URL): string[] {
  return uniqueHostnames([
    ...allowedHostnames(resourceUrl),
    "chatgpt.com",
    "chat.openai.com",
    "openai.com",
    ...localhostAllowedOrigins(),
  ]);
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

export function createStaffMcpHttpRoute(options: StaffMcpHttpRouteOptions) {
  const resourceUrl = options.resourceUrl();
  const mcpHandler = createMcpHandler(
    ({ authInfo }) =>
      buildStaffMcpServer(
        principalFromAuthInfo(authInfo),
        options.serverOptions
      ),
    {
      responseMode: "json",
      onerror(error) {
        console.error(`${options.logLabel} request failed`, error);
      },
    }
  );

  const requireMcpUser = requireBearerAuth({
    verifier: {
      verifyAccessToken: (token) =>
        verifyStaffMcpAccessToken(token, options.clientType),
    },
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  });

  const serve = async (request: Request): Promise<Response> => {
    const rejected =
      hostHeaderValidationResponse(request, allowedHostnames(resourceUrl)) ||
      originValidationResponse(request, allowedOriginHostnames(resourceUrl));
    if (rejected) return addHeaders(rejected);

    const authInfo = await requireMcpUser(request);
    if (authInfo instanceof Response) return addHeaders(authInfo);
    return addHeaders(await mcpHandler.fetch(request, { authInfo }));
  };

  const preflight = async () =>
    new Response(null, {
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

  return { serve, preflight };
}
