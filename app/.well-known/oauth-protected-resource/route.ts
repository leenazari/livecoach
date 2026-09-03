import {
  oauthMetadataResponse,
  oauthOptionsResponse,
  staffMcpProtectedResourceMetadata,
} from "@/lib/staff-mcp-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return oauthMetadataResponse(staffMcpProtectedResourceMetadata());
}

export async function OPTIONS() {
  return oauthOptionsResponse();
}
