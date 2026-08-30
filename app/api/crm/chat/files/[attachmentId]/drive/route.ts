import { NextRequest, NextResponse } from "next/server";

import {
  CHAT_ALLOWED_MIME_TYPES,
  CHAT_FILE_BUCKET,
  CHAT_MAX_FILE_BYTES,
  isUuid,
  requireChatMembership,
  safeChatFileName,
} from "@/lib/crm-chat";
import {
  ensureLiveCoachDriveFolder,
  findChatAttachmentInDrive,
  GoogleDriveError,
  uploadChatAttachmentToDrive,
} from "@/lib/google-drive";
import { getAccessToken } from "@/lib/google";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const noStore = { "Cache-Control": "private, no-store" };

export async function POST(
  _req: NextRequest,
  { params }: { params: { attachmentId: string } }
) {
  try {
    const scope = requireRequestScope();
    if (!isUuid(params.attachmentId)) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404, headers: noStore }
      );
    }

    const { data: attachment, error: attachmentError } = await supabaseService
      .from("crm_chat_attachments")
      .select(
        "id,workspace_id,conversation_id,kind,storage_path,file_name,mime_type,file_size"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("id", params.attachmentId)
      .eq("kind", "file")
      .maybeSingle();
    if (attachmentError) throw attachmentError;
    if (!attachment?.storage_path) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404, headers: noStore }
      );
    }

    const { conversation } = await requireChatMembership(
      scope,
      attachment.conversation_id
    );
    const mimeType = String(attachment.mime_type || "");
    const recordedSize = Number(attachment.file_size || 0);
    if (
      !CHAT_ALLOWED_MIME_TYPES.has(mimeType) ||
      !Number.isInteger(recordedSize) ||
      recordedSize < 1 ||
      recordedSize > CHAT_MAX_FILE_BYTES
    ) {
      return NextResponse.json(
        { error: "This chat file cannot be saved to Drive" },
        { status: 415, headers: noStore }
      );
    }

    const accessToken = await getAccessToken(false, scope.userId);
    if (!accessToken) {
      throw new GoogleDriveError(
        "Connect Google in Settings before saving files to Drive",
        428
      );
    }

    const driveIdentity = {
      accessToken,
      workspaceId: scope.workspaceId,
      attachmentId: attachment.id,
    };
    const existing = await findChatAttachmentInDrive(driveIdentity);
    if (existing?.webViewLink) {
      return NextResponse.json(
        {
          created: false,
          fileId: existing.id,
          fileName: existing.name,
          webViewLink: existing.webViewLink,
        },
        { headers: noStore }
      );
    }

    const folder = await ensureLiveCoachDriveFolder({
      accessToken,
      workspaceId: scope.workspaceId,
    });
    if (!folder.id) {
      throw new GoogleDriveError("Google Drive did not confirm the LiveCoach folder");
    }

    const { data: storedFile, error: storedFileError } =
      await supabaseService.storage
        .from(CHAT_FILE_BUCKET)
        .download(attachment.storage_path);
    if (storedFileError) throw storedFileError;
    if (!storedFile || storedFile.size < 1 || storedFile.size > CHAT_MAX_FILE_BYTES) {
      throw new Error("The stored chat file is invalid");
    }
    const content = await storedFile.arrayBuffer();
    const conversationLabel = String(
      conversation.kind === "group"
        ? conversation.name || "Private group"
        : "Direct message"
    ).slice(0, 120);
    const fileName = safeChatFileName(attachment.file_name);

    let saved;
    try {
      saved = await uploadChatAttachmentToDrive({
        accessToken,
        workspaceId: scope.workspaceId,
        conversationId: attachment.conversation_id,
        attachmentId: attachment.id,
        conversationLabel,
        folderId: folder.id,
        fileName,
        mimeType,
        content,
      });
    } catch (uploadError) {
      // A lost upload response can leave a valid file in Drive. Look it up by
      // its private app property before reporting a failure or allowing a retry.
      const recovered = await findChatAttachmentInDrive(driveIdentity).catch(
        () => null
      );
      if (!recovered?.webViewLink) throw uploadError;
      saved = recovered;
    }

    const { error: auditError } = await supabaseService
      .from("access_audit_events")
      .insert({
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        source: "human",
        action: "chat_attachment_saved_to_google_drive",
        target_table: "crm_chat_attachments",
        target_id: attachment.id,
        previous_scope: {},
        next_scope: {
          provider: "google_drive",
          conversation_id: attachment.conversation_id,
          google_file_id: saved.id,
        },
      });
    if (auditError) {
      console.error("Google Drive chat export audit failed", auditError.message);
    }

    return NextResponse.json(
      {
        created: true,
        fileId: saved.id,
        fileName: saved.name,
        webViewLink: saved.webViewLink,
      },
      { status: 201, headers: noStore }
    );
  } catch (error: any) {
    const message = String(error?.message || "");
    if (error instanceof GoogleDriveError) {
      return NextResponse.json(
        { error: message },
        { status: error.status, headers: noStore }
      );
    }
    if (/not found|membership/i.test(message)) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404, headers: noStore }
      );
    }
    console.error("Google Drive chat export failed", message || error);
    return NextResponse.json(
      { error: "The file could not be saved to Google Drive" },
      { status: 500, headers: noStore }
    );
  }
}
