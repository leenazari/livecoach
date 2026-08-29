import { NextRequest, NextResponse } from "next/server";

import {
  CHAT_FILE_BUCKET,
  isUuid,
  requireChatMembership,
  safeChatFileName,
} from "@/lib/crm-chat";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
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
        "id,workspace_id,conversation_id,kind,storage_path,file_name,mime_type,file_size"
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
    const { data: file, error: downloadError } = await supabaseService.storage
      .from(CHAT_FILE_BUCKET)
      .download(attachment.storage_path);
    if (downloadError) throw downloadError;
    const fileName = safeChatFileName(attachment.file_name);
    const fallbackName = fileName.replace(/[^a-zA-Z0-9._ -]/g, "_");
    return new NextResponse(await file.arrayBuffer(), {
      headers: {
        "Content-Type": attachment.mime_type || "application/octet-stream",
        "Content-Length": String(attachment.file_size || file.size),
        "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "File could not be downloaded" },
      { status: /not found|membership/i.test(error?.message || "") ? 404 : 500 }
    );
  }
}
