import { NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import {
  staffMcpAuthorizationServerMetadata,
} from "@/lib/staff-mcp-metadata";
import {
  chatGptPluginMcpResourceUrl,
  staffMcpResourceUrl,
} from "@/lib/staff-mcp-auth";
import { chatGptActionSchemaUrl } from "@/lib/chatgpt-action";
import { supabaseAdmin } from "@/lib/supabase";

import { PERSONAL_MCP_TOOLS } from '@/lib/staff-mcp-personal';
import { BRAIN_MCP_TOOLS } from '@/lib/staff-mcp-brain';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scope = requireRequestScope();
    let oauthEnabled = false;
    try {
      await staffMcpAuthorizationServerMetadata();
      oauthEnabled = true;
    } catch {
      oauthEnabled = false;
    }
    const { data: actionClients } = await supabaseAdmin
      .from("chatgpt_action_clients")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("active", true)
      .limit(1);
    return NextResponse.json(
      {
        endpoint: staffMcpResourceUrl().href,
        pluginEndpoint: chatGptPluginMcpResourceUrl().href,
        actionSchemaUrl: chatGptActionSchemaUrl(),
        actionConfigured: Boolean(actionClients?.length),
        oauthEnabled,
        toolCount: 6 + PERSONAL_MCP_TOOLS.length + BRAIN_MCP_TOOLS.length,
        access: "existing_brain_role_permissions",
        role: scope.role,
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
