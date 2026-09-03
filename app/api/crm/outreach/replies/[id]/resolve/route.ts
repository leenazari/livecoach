import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import { resolveReplyAttention } from "@/lib/reply-attention";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    if (!UUID.test(params.id)) {
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    // An ID is never sufficient authority. The reply must still belong to the
    // signed-in salesperson in this exact workspace before its alert can close.
    const { data: prospect, error: prospectError } = await supabaseAdmin
      .from("outreach_prospects")
      .select("id,last_reply_at")
      .eq("workspace_id", account.workspaceId)
      .eq("assigned_to_user_id", account.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (prospectError) throw prospectError;
    if (!prospect?.last_reply_at) {
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    const result = await resolveReplyAttention({
      workspaceId: account.workspaceId,
      userId: account.userId,
      prospectId: prospect.id,
      receivedAt: prospect.last_reply_at,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The reply could not be marked reviewed" },
      { status: 500 }
    );
  }
}
