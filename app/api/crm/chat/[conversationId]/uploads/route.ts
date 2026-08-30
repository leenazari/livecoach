import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  CHAT_ALLOWED_MIME_TYPES,
  CHAT_FILE_BUCKET,
  CHAT_MAX_FILE_BYTES,
  requireChatMembership,
  safeChatFileName,
} from "@/lib/crm-chat";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function POST(
  req: NextRequest,
  { params }: { params: { conversationId: string } }
) {
  try {
    const scope = requireRequestScope();
    const { conversation } = await requireChatMembership(
      scope,
      params.conversationId
    );
    const payload = await req.json().catch(() => ({}));
    const fileName = safeChatFileName(payload.fileName);
    const mimeType = String(payload.mimeType || "");
    const fileSize = Number(payload.fileSize);

    if (!Number.isInteger(fileSize) || fileSize < 1) {
      return NextResponse.json(
        { error: "Choose a valid file" },
        { status: 400, headers: noStore }
      );
    }
    if (fileSize > CHAT_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "Files are limited to 20 MB" },
        { status: 413, headers: noStore }
      );
    }
    if (!CHAT_ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: "That file type is not allowed in CRM chat" },
        { status: 415, headers: noStore }
      );
    }

    const storagePath = `${scope.workspaceId}/${conversation.id}/${scope.userId}/${randomUUID()}`;
    const { data, error } = await supabaseService.storage
      .from(CHAT_FILE_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (error) throw error;
    if (!data?.token) throw new Error("The upload could not be prepared");

    return NextResponse.json(
      {
        path: storagePath,
        token: data.token,
        fileName,
        mimeType,
        fileSize,
      },
      { status: 201, headers: noStore }
    );
  } catch (error: any) {
    const message = error?.message || "The upload could not be prepared";
    return NextResponse.json(
      { error: message },
      { status: /not found|membership/i.test(message) ? 404 : 500, headers: noStore }
    );
  }
}
