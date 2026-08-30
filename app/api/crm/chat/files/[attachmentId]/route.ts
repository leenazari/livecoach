import { NextRequest, NextResponse } from "next/server";

import {
  CHAT_FILE_BUCKET,
  isUuid,
  requireChatMembership,
  safeChatFileName,
} from "@/lib/crm-chat";
import { CHAT_INLINE_PREVIEW_MIME_TYPES } from "@/lib/crm-chat-shared";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { attachmentId: string } }
) {
  try {
    const scope = requireRequestScope();
    if (!isUuid(params.attachmentId)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const { data: attachment, error } = await supabaseService
      .from("crm_chat_attachments")
      .select(
        "id,workspace_id,conversation_id,kind,storage_path,file_name,mime_type"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("id", params.attachmentId)
      .eq("kind", "file")
      .maybeSingle();
    if (error) throw error;
    if (!attachment?.storage_path) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    await requireChatMembership(scope, attachment.conversation_id);
    const wantsInlinePreview = req.nextUrl.searchParams.get("mode") === "open";
    if (
      wantsInlinePreview &&
      !CHAT_INLINE_PREVIEW_MIME_TYPES.has(attachment.mime_type || "")
    ) {
      return NextResponse.json(
        { error: "This file is download only" },
        { status: 415 }
      );
    }
    const fileName = safeChatFileName(attachment.file_name);
    const signedFileRequest = wantsInlinePreview
      ? supabaseService.storage
          .from(CHAT_FILE_BUCKET)
          .createSignedUrl(attachment.storage_path, 60)
      : supabaseService.storage
          .from(CHAT_FILE_BUCKET)
          .createSignedUrl(attachment.storage_path, 60, { download: fileName });
    const { data: signedFile, error: signedFileError } = await signedFileRequest;
    if (signedFileError) throw signedFileError;
    if (!signedFile?.signedUrl) throw new Error("File could not be downloaded");
    const response = NextResponse.redirect(signedFile.signedUrl, 307);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "File could not be downloaded" },
      { status: /not found|membership/i.test(error?.message || "") ? 404 : 500 }
    );
  }
}
