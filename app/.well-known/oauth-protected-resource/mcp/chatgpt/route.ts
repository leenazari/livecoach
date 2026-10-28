import {
  chatGptPluginMcpProtectedResourceMetadata,
  oauthMetadataResponse,
  oauthOptionsResponse,
} from "@/lib/staff-mcp-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return oauthMetadataResponse(chatGptPluginMcpProtectedResourceMetadata());
}

export async function OPTIONS() {
  return oauthOptionsResponse();
}
