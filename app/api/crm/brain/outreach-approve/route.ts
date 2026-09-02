import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function post(
  request: NextRequest,
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>
) {
  const cookie = request.headers.get("cookie") || "";
  const response = await fetch(`${request.nextUrl.origin}${path}`, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = new Error(data?.error || `Outreach approval returned ${response.status}`) as Error & {
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
    const messageId = String(body?.messageId || "");
    if (!UUID.test(messageId)) {
      return NextResponse.json(
        { error: "Choose an exact outreach draft" },
        { status: 400 }
      );
    }
    const { data: message, error } = await supabaseAdmin
      .from("outreach_messages")
      .select("id,status,sender_user_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("sender_user_id", scope.userId)
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw error;
    if (!message) {
      return NextResponse.json(
        { error: "This draft is not assigned to your account" },
        { status: 404 }
      );
    }
    if (!["approved", "sending", "sent"].includes(message.status)) {
      await post(
        request,
        `/api/crm/outreach/messages/${messageId}`,
        "PATCH",
        { status: "approved" }
      );
    }
    const queued = ["sending", "sent"].includes(message.status)
      ? { status: message.status, queued: true, reused: true }
      : await post(
          request,
          `/api/crm/outreach/messages/${messageId}/send`,
          "POST",
          {}
        );
    return NextResponse.json({ ok: true, messageId, ...queued });
  } catch (error: any) {
    return NextResponse.json(
      error?.data || { error: error?.message || "The outreach email was not approved and queued" },
      { status: error?.status || 500 }
    );
  }
}

