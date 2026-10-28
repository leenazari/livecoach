import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  chatGptActionCallbackUrls,
  chatGptActionSchemaUrl,
  normaliseChatGptId,
} from "@/lib/chatgpt-action";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { requireWorkspaceOwner } from "@/lib/request-scope";
import { staffMcpAuthorizationServerMetadata } from "@/lib/staff-mcp-metadata";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { publicAppOrigin } from "@/lib/public-app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
};

function blocked(
  status: number,
  input: Parameters<typeof crmBlockerPayload>[0]
) {
  return NextResponse.json(crmBlockerPayload(input), {
    status,
    headers: noStore,
  });
}

async function oauthSettings() {
  const metadata = await staffMcpAuthorizationServerMetadata();
  return {
    authorizationUrl: String(metadata.authorization_endpoint || ""),
    tokenUrl: String(metadata.token_endpoint || ""),
    scope: "email",
    tokenMethod: "POST",
    privacyPolicyUrl: `${publicAppOrigin()}/privacy`,
  };
}

export async function GET() {
  let scope;
  try {
    scope = requireWorkspaceOwner();
  } catch {
    return blocked(403, {
      code: "chatgpt_action_owner_required",
      title: "Custom GPT setup is owner-only",
      reason: "OAuth credentials control a shared CRM connection and cannot be created by staff accounts",
      nextAction: "Ask the LiveCoach workspace owner to finish the one-time Custom GPT setup",
      responsible: "owner",
    });
  }

  const { data, error } = await supabaseAdmin
    .from("chatgpt_action_clients")
    .select("id,gpt_id,oauth_client_id,client_name,active,created_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false });
  if (error) {
    return blocked(500, {
      code: "chatgpt_action_setup_unavailable",
      title: "Custom GPT setup could not be loaded",
      reason: "LiveCoach could not confirm the registered action clients",
      nextAction: "Refresh Settings once. If it still fails, share this blocker code with the development team",
      responsible: "system",
    });
  }
  let oauth;
  try {
    oauth = await oauthSettings();
  } catch {
    return blocked(503, {
      code: "chatgpt_action_oauth_unavailable",
      title: "Custom GPT setup cannot be loaded yet",
      reason: "The LiveCoach OAuth service is not ready to issue a safe connection",
      nextAction: "Keep Settings open and share this blocker code with the development team",
      responsible: "system",
    });
  }
  return NextResponse.json(
    {
      ok: true,
      schemaUrl: chatGptActionSchemaUrl(),
      oauth,
      clients: data || [],
    },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  const reference = randomUUID();
  let scope;
  try {
    scope = requireWorkspaceOwner();
  } catch {
    return blocked(403, {
      code: "chatgpt_action_owner_required",
      title: "Custom GPT setup is owner-only",
      reason: "OAuth credentials control a shared CRM connection and cannot be created by staff accounts",
      nextAction: "Ask the LiveCoach workspace owner to finish the one-time Custom GPT setup",
      responsible: "owner",
      reference,
    });
  }

  const body = await request.json().catch(() => ({}));
  const gptId = normaliseChatGptId(body.gptId);
  if (!gptId) {
    return blocked(400, {
      code: "chatgpt_action_gpt_id_invalid",
      title: "The Custom GPT address is incomplete",
      reason: "LiveCoach needs the GPT ID beginning with g- so it can register the exact ChatGPT callback",
      nextAction: "Open the Custom GPT editor, copy its address and paste it here",
      responsible: "user",
      reference,
    });
  }

  let oauth;
  try {
    oauth = await oauthSettings();
  } catch {
    return blocked(503, {
      code: "chatgpt_action_oauth_unavailable",
      title: "Custom GPT setup cannot start yet",
      reason: "The LiveCoach OAuth service is not ready to issue a safe connection",
      nextAction: "Keep the GPT editor open and share this blocker code with the development team",
      responsible: "system",
      reference,
    });
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("chatgpt_action_clients")
    .select("id,gpt_id,oauth_client_id,client_name,active,created_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("gpt_id", gptId)
    .maybeSingle();
  if (existingError) {
    return blocked(500, {
      code: "chatgpt_action_setup_not_confirmed",
      title: "Custom GPT setup was not started",
      reason: "LiveCoach could not check whether this GPT is already registered",
      nextAction: "Refresh Settings once. If it still fails, share this blocker code with the development team",
      responsible: "system",
      reference,
    });
  }

  if (existing) {
    return NextResponse.json(
      {
        ok: true,
        created: false,
        existing: true,
        clientId: existing.oauth_client_id,
        clientSecret: null,
        secretAvailable: false,
        schemaUrl: chatGptActionSchemaUrl(),
        callbackUrls: chatGptActionCallbackUrls(gptId),
        oauth,
        message:
          "This GPT is already registered. LiveCoach cannot show its secret again because it was never stored.",
        nextStep:
          "Use the secret saved in the GPT editor. If it was lost, create a new GPT before generating a fresh connection.",
      },
      { headers: noStore }
    );
  }

  const callbackUrls = chatGptActionCallbackUrls(gptId);
  const clientName = `LiveCoach CRM GPT Action ${gptId}`.slice(0, 200);
  const { data: oauthClient, error: createError } =
    await supabaseService.auth.admin.oauth.createClient({
      client_name: clientName,
      client_uri: "https://chatgpt.com",
      redirect_uris: callbackUrls,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "email",
      token_endpoint_auth_method: "client_secret_post",
    });

  if (createError || !oauthClient?.client_id || !oauthClient.client_secret) {
    return blocked(502, {
      code: "chatgpt_action_oauth_not_created",
      title: "Custom GPT credentials were not created",
      reason: "The LiveCoach identity service did not confirm a complete OAuth client",
      nextAction: "Keep the GPT editor open and share this blocker code with the development team",
      responsible: "system",
      reference,
    });
  }

  const { error: registrationError } = await supabaseAdmin
    .from("chatgpt_action_clients")
    .insert({
      workspace_id: scope.workspaceId,
      oauth_client_id: oauthClient.client_id,
      gpt_id: gptId,
      client_name: clientName,
      created_by: scope.userId,
      active: true,
    });

  if (registrationError) {
    const { error: cleanupError } =
      await supabaseService.auth.admin.oauth.deleteClient(oauthClient.client_id);
    if (cleanupError) {
      console.error("Unlinked ChatGPT Action OAuth client", {
        reference,
        clientId: oauthClient.client_id,
      });
      return blocked(500, {
        code: "chatgpt_action_registration_partial",
        title: "Custom GPT setup needs technical review",
        reason: "The OAuth client was created but LiveCoach could not safely link it to this workspace",
        outcome: "No client secret was displayed and the connection remains blocked",
        nextAction: "Share this blocker code and reference with the development team before trying again",
        responsible: "system",
        reference,
      });
    }
    return blocked(500, {
      code: "chatgpt_action_registration_rolled_back",
      title: "Custom GPT setup was not saved",
      reason: "LiveCoach could not link the OAuth client to this workspace",
      outcome: "The newly created OAuth client was removed, so no unfinished connection remains",
      nextAction: "Refresh Settings once. If it still fails, share this blocker code with the development team",
      responsible: "system",
      reference,
    });
  }

  return NextResponse.json(
    {
      ok: true,
      created: true,
      existing: false,
      clientId: oauthClient.client_id,
      clientSecret: oauthClient.client_secret,
      secretAvailable: true,
      schemaUrl: chatGptActionSchemaUrl(),
      callbackUrls,
      oauth,
      message:
        "The OAuth client is linked to this workspace. Copy the secret into the GPT editor now because LiveCoach will not store or show it again.",
    },
    { status: 201, headers: noStore }
  );
}
