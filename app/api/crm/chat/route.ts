import { NextRequest, NextResponse } from "next/server";

import { cleanChatText, isUuid } from "@/lib/crm-chat";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const scope = requireRequestScope();
    const [ownMembershipsResult, workspaceMembersResult] = await Promise.all([
      supabaseService
        .from("crm_chat_conversation_members")
        .select("conversation_id,unread_count,last_read_at,joined_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("user_id", scope.userId),
      supabaseService
        .from("workspace_members")
        .select("user_id,role,status")
        .eq("workspace_id", scope.workspaceId)
        .eq("status", "active")
        .order("created_at", { ascending: true }),
    ]);
    if (ownMembershipsResult.error) throw ownMembershipsResult.error;
    if (workspaceMembersResult.error) throw workspaceMembersResult.error;

    const conversationIds = (ownMembershipsResult.data || []).map(
      (row: any) => row.conversation_id
    );
    const workspaceUserIds = (workspaceMembersResult.data || []).map(
      (row: any) => row.user_id
    );
    const [conversationsResult, conversationMembersResult, profilesResult] =
      await Promise.all([
        conversationIds.length
          ? supabaseService
              .from("crm_chat_conversations")
              .select(
                "id,kind,name,created_by_user_id,last_message_id,last_message_at,created_at,updated_at"
              )
              .eq("workspace_id", scope.workspaceId)
              .in("id", conversationIds)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [] as any[], error: null }),
        conversationIds.length
          ? supabaseService
              .from("crm_chat_conversation_members")
              .select("conversation_id,user_id,joined_at")
              .eq("workspace_id", scope.workspaceId)
              .in("conversation_id", conversationIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        workspaceUserIds.length
          ? supabaseService
              .from("profiles")
              .select("user_id,display_name,email")
              .in("user_id", workspaceUserIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);
    if (conversationsResult.error) throw conversationsResult.error;
    if (conversationMembersResult.error) throw conversationMembersResult.error;
    if (profilesResult.error) throw profilesResult.error;

    const lastMessageIds = (conversationsResult.data || [])
      .map((row: any) => row.last_message_id)
      .filter(Boolean);
    const [lastMessagesResult, lastAttachmentsResult] = await Promise.all([
      lastMessageIds.length
        ? supabaseService
            .from("crm_chat_messages")
            .select("id,sender_user_id,body,created_at")
            .eq("workspace_id", scope.workspaceId)
            .in("id", lastMessageIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      lastMessageIds.length
        ? supabaseService
            .from("crm_chat_attachments")
            .select("message_id,kind,title")
            .eq("workspace_id", scope.workspaceId)
            .in("message_id", lastMessageIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (lastMessagesResult.error) throw lastMessagesResult.error;
    if (lastAttachmentsResult.error) throw lastAttachmentsResult.error;

    const profiles = new Map(
      (profilesResult.data || []).map((row: any) => [row.user_id, row])
    );
    const membershipByConversation = new Map(
      (ownMembershipsResult.data || []).map((row: any) => [
        row.conversation_id,
        row,
      ])
    );
    const membersByConversation = new Map<string, any[]>();
    for (const row of conversationMembersResult.data || []) {
      const list = membersByConversation.get(row.conversation_id) || [];
      list.push({
        userId: row.user_id,
        displayName:
          (profiles.get(row.user_id) as any)?.display_name || "Workspace member",
        email: (profiles.get(row.user_id) as any)?.email || null,
      });
      membersByConversation.set(row.conversation_id, list);
    }
    const messageById = new Map(
      (lastMessagesResult.data || []).map((row: any) => [row.id, row])
    );
    const attachmentByMessage = new Map(
      (lastAttachmentsResult.data || []).map((row: any) => [row.message_id, row])
    );

    const conversations = (conversationsResult.data || []).map((row: any) => {
      const members = membersByConversation.get(row.id) || [];
      const otherMembers = members.filter(
        (member) => member.userId !== scope.userId
      );
      const lastMessage = row.last_message_id
        ? (messageById.get(row.last_message_id) as any)
        : null;
      const lastAttachment = row.last_message_id
        ? (attachmentByMessage.get(row.last_message_id) as any)
        : null;
      const membership = membershipByConversation.get(row.id) as any;
      const directName =
        otherMembers.map((member) => member.displayName).join(", ") ||
        "Direct message";
      const preview = lastMessage?.body
        ? String(lastMessage.body).replace(/\s+/g, " ").slice(0, 120)
        : lastAttachment
          ? `Shared ${String(lastAttachment.kind).replace("_", " ")}`
          : "No messages yet";
      return {
        id: row.id,
        kind: row.kind,
        name: row.kind === "group" ? row.name : directName,
        members,
        unreadCount: membership?.unread_count || 0,
        lastReadAt: membership?.last_read_at || null,
        lastMessageAt: row.last_message_at,
        lastMessage: lastMessage
          ? {
              senderUserId: lastMessage.sender_user_id,
              senderName:
                (profiles.get(lastMessage.sender_user_id) as any)?.display_name ||
                "Workspace member",
              preview,
              createdAt: lastMessage.created_at,
            }
          : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    return NextResponse.json(
      {
        currentUserId: scope.userId,
        conversations,
        members: (workspaceMembersResult.data || []).map((member: any) => ({
          userId: member.user_id,
          role: member.role,
          displayName:
            (profiles.get(member.user_id) as any)?.display_name ||
            "Workspace member",
          email: (profiles.get(member.user_id) as any)?.email || null,
        })),
      },
      { headers: noStore }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Chat could not be loaded" },
      { status: 500, headers: noStore }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const kind = body?.kind === "group" ? "group" : "direct";
    const name = cleanChatText(body?.name, 80);
    const memberIds = Array.isArray(body?.memberIds)
      ? [...new Set(body.memberIds.map(String).filter(isUuid))]
      : [];
    if (!memberIds.length || memberIds.length > 49) {
      return NextResponse.json(
        { error: "Choose at least one active workspace member" },
        { status: 400, headers: noStore }
      );
    }
    if (kind === "direct" && memberIds.length !== 1) {
      return NextResponse.json(
        { error: "Choose one person for a direct message" },
        { status: 400, headers: noStore }
      );
    }
    if (kind === "group" && !name) {
      return NextResponse.json(
        { error: "Give the group a name" },
        { status: 400, headers: noStore }
      );
    }

    const { data, error } = await supabaseService.rpc(
      "create_crm_chat_conversation_service",
      {
        p_actor_user_id: scope.userId,
        p_workspace_id: scope.workspaceId,
        p_kind: kind,
        p_name: kind === "group" ? name : null,
        p_member_ids: memberIds,
      }
    );
    if (error) throw error;
    if (!data?.id || !isUuid(data.id)) {
      throw new Error("The database did not confirm the conversation");
    }

    return NextResponse.json(
      { conversation: data },
      { status: data.existing ? 200 : 201, headers: noStore }
    );
  } catch (error: any) {
    const message = error?.message || "Conversation could not be created";
    const status = /choose|name|member|active/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers: noStore });
  }
}
