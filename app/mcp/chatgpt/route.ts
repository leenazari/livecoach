import { chatGptPluginMcpResourceUrl } from "@/lib/staff-mcp-auth";
import { createStaffMcpHttpRoute } from "@/lib/staff-mcp-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const route = createStaffMcpHttpRoute({
  clientType: "chatgpt_plugin",
  resourceUrl: chatGptPluginMcpResourceUrl,
  logLabel: "LiveCoach ChatGPT plugin MCP",
  serverOptions: { coreOnly: true },
});

export const POST = route.serve;
export const GET = route.serve;
export const DELETE = route.serve;
export const OPTIONS = route.preflight;
