import { NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import {
  staffMcpAuthorizationServerMetadata,
} from "@/lib/staff-mcp-metadata";
import { staffMcpResourceUrl } from "@/lib/staff-mcp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireRequestScope();
    let oauthEnabled = false;
    try {
      await staffMcpAuthorizationServerMetadata();
      oauthEnabled = true;
    } catch {
      oauthEnabled = false;
    }
    return NextResponse.json(
      {
        endpoint: staffMcpResourceUrl().href,
        oauthEnabled,
        toolCount: 6,
        access: "own_assigned_only",
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MCP status unavailable" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
