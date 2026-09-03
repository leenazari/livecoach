import { NextRequest, NextResponse } from "next/server";

import {
  followUpAtIsPast,
  normaliseFollowUpAt,
} from "@/lib/follow-up-scheduling";
import { saveOutreachFollowUpTask } from "@/lib/outreach-follow-up";
import { requireRequestScope } from "@/lib/request-scope";
import { resolveReplyAttention } from "@/lib/reply-attention";
import { supabaseAdmin } from "@/lib/supabase";
import { capitaliseSentenceStarts } from "@/lib/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clean = (value: unknown, max: number) =>
  capitaliseSentenceStarts(
    String(value || "").replace(/\s+/g, " ").trim()
  ).slice(0, max);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    if (!UUID.test(params.id)) {
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    const reminderText = clean(body.text, 500);
    const dueAt = normaliseFollowUpAt(body.followUpAt);
    if (!UUID.test(requestId)) {
      return NextResponse.json(
        { error: "Refresh this follow-up form and try again" },
        { status: 400 }
      );
    }
    if (reminderText.length < 3) {
      return NextResponse.json(
        { error: "Add what you need to follow up about" },
        { status: 400 }
      );
    }
    if (!dueAt) {
      return NextResponse.json(
        { error: "Choose a valid follow-up date and time" },
        { status: 400 }
      );
    }
    if (followUpAtIsPast(dueAt)) {
      return NextResponse.json(
        { error: "Choose a follow-up time that has not already passed" },
        { status: 400 }
      );
    }

    const { data: prospect, error: prospectError } = await supabaseAdmin
      .from("outreach_prospects")
      .select(
        "id,first_name,last_name,company_name,crm_company_id,assigned_to_user_id"
      )
      .eq("workspace_id", scope.workspaceId)
      .eq("assigned_to_user_id", scope.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (prospectError) throw prospectError;
    if (!prospect) {
      return NextResponse.json(
        { error: "This prospect is not assigned to your account" },
        { status: 404 }
      );
    }

    const result = await saveOutreachFollowUpTask({
      scope,
      prospect,
      requestId,
      text: reminderText,
      dueAt,
      source: "outreach_manual_follow_up",
    });

    let attentionResolved = true;
    try {
      await resolveReplyAttention({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        prospectId: prospect.id,
      });
    } catch {
      // The dated reminder is already canonical and safe to retry. Do not make
      // a successful save look failed because an attention receipt lagged.
      attentionResolved = false;
    }

    return NextResponse.json({ ok: true, ...result, attentionResolved });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The follow-up reminder could not be saved" },
      { status: 500 }
    );
  }
}
