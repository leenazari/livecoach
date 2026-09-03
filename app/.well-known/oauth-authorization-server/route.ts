import {
  oauthMetadataResponse,
  oauthOptionsResponse,
  staffMcpAuthorizationServerMetadata,
} from "@/lib/staff-mcp-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return oauthMetadataResponse(await staffMcpAuthorizationServerMetadata());
  } catch {
    return oauthMetadataResponse(
      {
        error: "temporarily_unavailable",
        error_description: "LiveCoach OAuth connection setup is not available yet.",
      },
      503
    );
  }
}

export async function OPTIONS() {
  return oauthOptionsResponse();
}
