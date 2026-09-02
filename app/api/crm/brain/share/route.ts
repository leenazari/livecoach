import { NextRequest, NextResponse } from "next/server";

import { cleanChatText, isUuid } from "@/lib/crm-chat";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function call(
  request: NextRequest,
  path: string,
  body: Record<string, unknown>
) {
  const cookie = request.headers.get("cookie") || "";
  const response = await fetch(`${request.nextUrl.origin}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = new Error(data?.error || `Team chat returned ${response.status}`) as Error & {
      status?: number;
      data?: any;
    };
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function POST(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const requestId = String(body?.requestId || "");
    const message = cleanChatText(body?.message, 5000);
    const recordKind = String(body?.recordKind || "");
    const recordId = String(body?.recordId || "");
    const suppliedConversationId = String(body?.conversationId || "");
    const memberIds = Array.isArray(body?.memberIds)
      ? [...new Set(body.memberIds.map(String).filter(isUuid))]
      : [];
    const groupName = cleanChatText(body?.groupName, 80);
    if (!isUuid(requestId)) {
      return NextResponse.json(
        { error: "This shared message needs a valid retry key" },
        { status: 400 }
      );
    }
    if (!message && !(recordKind && isUuid(recordId))) {
      return NextResponse.json(
        { error: "Write a message or choose an exact CRM record to share" },
        { status: 400 }
      );
    }

    const { data: existing, error: existingError } = await supabaseService
      .from("crm_chat_messages")
      .select("id,conversation_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("sender_user_id", scope.userId)
      .eq("client_nonce", requestId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return NextResponse.json({
        ok: true,
        messageId: existing.id,
        conversationId: existing.conversation_id,
        existing: true,
        href: `/crm/chat?conversation=${existing.conversation_id}`,
      });
    }

    let conversationId = suppliedConversationId;
    if (!isUuid(conversationId)) {
      if (!memberIds.length || memberIds.includes(scope.userId)) {
        return NextResponse.json(
          { error: "Choose one or more other active workspace members" },
          { status: 400 }
        );
      }
      const { data: activeMembers, error: memberError } = await supabaseService
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("status", "active")
        .in("user_id", memberIds);
      if (memberError) throw memberError;
      if ((activeMembers || []).length !== memberIds.length) {
        return NextResponse.json(
          { error: "One of the selected chat members is not active in this workspace" },
          { status: 400 }
        );
      }
      const conversation = await call(request, "/api/crm/chat", {
        kind: memberIds.length === 1 && !groupName ? "direct" : "group",
        name: groupName || undefined,
        memberIds,
      });
      conversationId = String(conversation?.conversation?.id || "");
    }
    if (!isUuid(conversationId)) {
      throw new Error("The database did not confirm the team conversation");
    }

    const result = await call(
      request,
      `/api/crm/chat/${conversationId}/messages`,
      {
        body: message,
        clientNonce: requestId,
        ...(recordKind && isUuid(recordId) ? { recordKind, recordId } : {}),
      }
    );
    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      conversationId,
      existing: !!result.existing,
      href: `/crm/chat?conversation=${conversationId}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      error?.data || { error: error?.message || "The CRM item was not shared" },
      { status: error?.status || 500 }
    );
  }
}

