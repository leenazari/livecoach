import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";

import {
  CHAT_ALLOWED_MIME_TYPES,
  CHAT_FILE_BUCKET,
  CHAT_MAX_FILE_BYTES,
  CHAT_MAX_MESSAGE_LENGTH,
  buildChatRecordAttachment,
  cleanChatText,
  isUuid,
  requireChatMembership,
  safeChatFileName,
  sendChatEmailNotifications,
  type ChatAttachmentInput,
} from "@/lib/crm-chat";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(
  _req: NextRequest,
  { params }: { params: { conversationId: string } }
) {
  try {
    const scope = requireRequestScope();
    const { conversation } = await requireChatMembership(
      scope,
      params.conversationId
    );
    const { data: descending, error: messageError } = await supabaseService
      .from("crm_chat_messages")
      .select("id,sender_user_id,body,created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (messageError) throw messageError;
    const rows = (descending || []).reverse();
    const messageIds = rows.map((row: any) => row.id);
    const senderIds = [...new Set(rows.map((row: any) => row.sender_user_id))];
    const [attachmentsResult, profilesResult, membersResult] = await Promise.all([
      messageIds.length
        ? supabaseService
            .from("crm_chat_attachments")
            .select(
              "id,message_id,kind,target_id,title,subtitle,href,snapshot,file_name,mime_type,file_size,created_at"
            )
            .eq("workspace_id", scope.workspaceId)
            .eq("conversation_id", conversation.id)
            .in("message_id", messageIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as any[], error: null }),
      senderIds.length
        ? supabaseService
            .from("profiles")
            .select("user_id,display_name")
            .in("user_id", senderIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      supabaseService
        .from("crm_chat_conversation_members")
        .select("user_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("conversation_id", conversation.id),
    ]);
    if (attachmentsResult.error) throw attachmentsResult.error;
    if (profilesResult.error) throw profilesResult.error;
    if (membersResult.error) throw membersResult.error;

    const memberIds = (membersResult.data || []).map((row: any) => row.user_id);
    const missingProfileIds = memberIds.filter(
      (id: string) => !senderIds.includes(id)
    );
    const { data: missingProfiles, error: missingProfilesError } =
      missingProfileIds.length
        ? await supabaseService
            .from("profiles")
            .select("user_id,display_name")
            .in("user_id", missingProfileIds)
        : { data: [] as any[], error: null };
    if (missingProfilesError) throw missingProfilesError;
    const profiles = new Map(
      [...(profilesResult.data || []), ...(missingProfiles || [])].map(
        (row: any) => [row.user_id, row.display_name || "Workspace member"]
      )
    );
    const attachmentsByMessage = new Map<string, any[]>();
    for (const attachment of attachmentsResult.data || []) {
      const list = attachmentsByMessage.get(attachment.message_id) || [];
      list.push({
        id: attachment.id,
        kind: attachment.kind,
        targetId: attachment.target_id,
        title: attachment.title,
        subtitle: attachment.subtitle,
        href:
          attachment.kind === "file"
            ? `/api/crm/chat/files/${attachment.id}`
            : attachment.href,
        snapshot: attachment.snapshot || {},
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        fileSize: attachment.file_size,
        createdAt: attachment.created_at,
      });
      attachmentsByMessage.set(attachment.message_id, list);
    }

    const readAt = new Date().toISOString();
    const [readResult, notificationResult] = await Promise.all([
      supabaseService
        .from("crm_chat_conversation_members")
        .update({ unread_count: 0, last_read_at: readAt })
        .eq("workspace_id", scope.workspaceId)
        .eq("conversation_id", conversation.id)
        .eq("user_id", scope.userId),
      supabaseService
        .from("crm_notifications")
        .update({ read_at: readAt, snoozed_until: null })
        .eq("workspace_id", scope.workspaceId)
        .eq("user_id", scope.userId)
        .eq("kind", "chat_message")
        .eq("href", `/crm/chat?conversation=${conversation.id}`)
        .is("dismissed_at", null)
        .is("read_at", null),
    ]);
    if (readResult.error) throw readResult.error;
    if (notificationResult.error) throw notificationResult.error;

    return NextResponse.json(
      {
        conversation: {
          id: conversation.id,
          kind: conversation.kind,
          name: conversation.name,
          members: memberIds.map((userId: string) => ({
            userId,
            displayName: profiles.get(userId) || "Workspace member",
          })),
        },
        currentUserId: scope.userId,
        messages: rows.map((row: any) => ({
          id: row.id,
          senderUserId: row.sender_user_id,
          senderName: profiles.get(row.sender_user_id) || "Workspace member",
          body: row.body,
          attachments: attachmentsByMessage.get(row.id) || [],
          createdAt: row.created_at,
        })),
        readAt,
      },
      { headers: noStore }
    );
  } catch (error: any) {
    const message = error?.message || "Messages could not be loaded";
    return NextResponse.json(
      { error: message },
      { status: /not found|membership/i.test(message) ? 404 : 500, headers: noStore }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { conversationId: string } }
) {
  let uploadedPath = "";
  try {
    const scope = requireRequestScope();
    const { conversation } = await requireChatMembership(
      scope,
      params.conversationId
    );
    const form = await req.formData();
    const body = cleanChatText(form.get("body"), CHAT_MAX_MESSAGE_LENGTH);
    const clientNonce = String(form.get("clientNonce") || "");
    if (!isUuid(clientNonce)) {
      return NextResponse.json(
        { error: "This message needs a valid retry key" },
        { status: 400, headers: noStore }
      );
    }

    const attachments: ChatAttachmentInput[] = [];
    const recordKind = String(form.get("recordKind") || "");
    const recordId = String(form.get("recordId") || "");
    if (recordKind || recordId) {
      attachments.push(
        await buildChatRecordAttachment(scope, recordKind, recordId)
      );
    }

    const fileValue = form.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
    if (file) {
      if (file.size > CHAT_MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "Files are limited to 10 MB" },
          { status: 413, headers: noStore }
        );
      }
      if (!CHAT_ALLOWED_MIME_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: "That file type is not allowed in CRM chat" },
          { status: 415, headers: noStore }
        );
      }
      const messageId = randomUUID();
      const fileName = safeChatFileName(file.name);
      uploadedPath = `${scope.workspaceId}/${conversation.id}/${messageId}/${fileName}`;
      const { error: uploadError } = await supabaseService.storage
        .from(CHAT_FILE_BUCKET)
        .upload(uploadedPath, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type,
          upsert: false,
          cacheControl: "private, max-age=0",
        });
      if (uploadError) throw uploadError;
      attachments.push({
        kind: "file",
        title: fileName,
        subtitle: `${Math.max(1, Math.round(file.size / 1024))} KB`,
        storagePath: uploadedPath,
        fileName,
        mimeType: file.type,
        fileSize: file.size,
        snapshot: {},
      });

      const { data, error } = await supabaseService.rpc(
        "post_crm_chat_message_service",
        {
          p_actor_user_id: scope.userId,
          p_workspace_id: scope.workspaceId,
          p_conversation_id: conversation.id,
          p_message_id: messageId,
          p_client_nonce: clientNonce,
          p_body: body,
          p_attachments: attachments,
        }
      );
      if (error) throw error;
      if (!data?.id || !isUuid(data.id)) {
        throw new Error("The database did not confirm the message");
      }
      if (data.existing && uploadedPath) {
        await supabaseService.storage.from(CHAT_FILE_BUCKET).remove([uploadedPath]);
        uploadedPath = "";
      }
      if (!data.existing) {
        waitUntil(
          sendChatEmailNotifications({
            scope,
            conversationId: conversation.id,
            messageId: data.id,
            requestOrigin: req.nextUrl.origin,
          }).catch((emailError) =>
            console.error("Chat email notification failed", emailError)
          )
        );
      }
      return NextResponse.json(
        { ok: true, messageId: data.id, existing: !!data.existing },
        { status: data.existing ? 200 : 201, headers: noStore }
      );
    }

    const messageId = randomUUID();
    const { data, error } = await supabaseService.rpc(
      "post_crm_chat_message_service",
      {
        p_actor_user_id: scope.userId,
        p_workspace_id: scope.workspaceId,
        p_conversation_id: conversation.id,
        p_message_id: messageId,
        p_client_nonce: clientNonce,
        p_body: body,
        p_attachments: attachments,
      }
    );
    if (error) throw error;
    if (!data?.id || !isUuid(data.id)) {
      throw new Error("The database did not confirm the message");
    }
    if (!data.existing) {
      waitUntil(
        sendChatEmailNotifications({
          scope,
          conversationId: conversation.id,
          messageId: data.id,
          requestOrigin: req.nextUrl.origin,
        }).catch((emailError) =>
          console.error("Chat email notification failed", emailError)
        )
      );
    }
    return NextResponse.json(
      { ok: true, messageId: data.id, existing: !!data.existing },
      { status: data.existing ? 200 : 201, headers: noStore }
    );
  } catch (error: any) {
    if (uploadedPath) {
      await supabaseService.storage.from(CHAT_FILE_BUCKET).remove([uploadedPath]);
    }
    const message = error?.message || "Message could not be sent";
    const status = /choose|write|valid|limited|allowed|member|confidential|not found/i.test(
      message
    )
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status, headers: noStore });
  }
}
