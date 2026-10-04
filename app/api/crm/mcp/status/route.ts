import { NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import {
  staffMcpAuthorizationServerMetadata,
} from "@/lib/staff-mcp-metadata";
import { staffMcpResourceUrl } from "@/lib/staff-mcp-auth";

import { PERSONAL_MCP_TOOLS } from '@/lib/staff-mcp-personal';
import { BRAIN_MCP_TOOLS } from '@/lib/staff-mcp-brain';

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
        toolCount: 6 + PERSONAL_MCP_TOOLS.length + BRAIN_MCP_TOOLS.length,
        access: "existing_brain_role_permissions",
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
