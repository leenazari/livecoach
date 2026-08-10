import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { removeDashesFromProse } from "@/lib/outreach-voice";

const ACTIONS = new Set(["comment", "message", "prepare_outreach", "follow_up", "ignore"]);
const STATUSES = new Set(["new", "reviewed", "approved", "acted", "dismissed"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("outreach_signals")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return NextResponse.json({ error: "That buying signal no longer exists." }, { status: 404 });

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    const nextAction = ACTIONS.has(body.recommended_action) ? body.recommended_action : existing.recommended_action;
    const nextDraft = typeof body.draft_text === "string"
      ? removeDashesFromProse(body.draft_text.trim()).slice(0, 1400)
      : String(existing.draft_text || "");
    const contentChanged = nextAction !== existing.recommended_action || nextDraft !== String(existing.draft_text || "");
    patch.recommended_action = nextAction;
    patch.draft_text = nextAction === "ignore" ? null : nextDraft || null;

    if (body.status !== undefined && !STATUSES.has(body.status))
      return NextResponse.json({ error: "That signal status is not valid." }, { status: 400 });
    if (body.status === "approved") {
      if (nextAction === "ignore")
        return NextResponse.json({ error: "Dismiss an irrelevant signal instead of approving it." }, { status: 400 });
      if (!nextDraft)
        return NextResponse.json({ error: "Add the exact wording you want to approve first." }, { status: 400 });
      patch.status = "approved";
      patch.approved_at = new Date().toISOString();
      patch.acted_at = null;
    } else if (body.status === "acted") {
      if (existing.status !== "approved")
        return NextResponse.json({ error: "Approve the exact wording before marking it actioned." }, { status: 400 });
      if (contentChanged)
        return NextResponse.json({ error: "Save and approve the changed wording before marking it actioned." }, { status: 400 });
      patch.status = "acted";
      patch.acted_at = new Date().toISOString();
    } else if (body.status === "dismissed") {
      patch.status = "dismissed";
      patch.approved_at = null;
      patch.acted_at = null;
    } else if (body.status === "reviewed") {
      patch.status = "reviewed";
      patch.approved_at = null;
      patch.acted_at = null;
    } else if (contentChanged && existing.status === "approved") {
      patch.status = "reviewed";
      patch.approved_at = null;
      patch.acted_at = null;
    }

    const { data, error } = await supabaseAdmin
      .from("outreach_signals")
      .update(patch)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ signal: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not save this buying signal." }, { status: 500 });
  }
}
