import { staffMcpResourceUrl } from "@/lib/staff-mcp-auth";
import { createStaffMcpHttpRoute } from "@/lib/staff-mcp-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const route = createStaffMcpHttpRoute({
  clientType: "mcp",
  resourceUrl: staffMcpResourceUrl,
  logLabel: "LiveCoach staff MCP",
});

export const POST = route.serve;
export const GET = route.serve;
export const DELETE = route.serve;
export const OPTIONS = route.preflight;
