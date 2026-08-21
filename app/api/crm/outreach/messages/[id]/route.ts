import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sender = await resolveOutreachIdentity();
    const body = await req.json();
    const { data: existing } = await supabaseAdmin.from("outreach_messages").select("*").eq("id", params.id).single();
    if (!existing || existing.status === "sent") return NextResponse.json({ error: "A sent email cannot be changed" }, { status: 400 });
    if (existing.sender_user_id !== sender.userId || existing.from_email !== sender.senderEmail)
      return NextResponse.json({ error: "This draft belongs to another sender" }, { status: 403 });
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    const nextSubject = typeof body.subject === "string" && body.subject.trim()
      ? removeDashesFromProse(body.subject.trim()).slice(0, 120)
      : removeDashesFromProse(existing.subject);
    const nextBody = typeof body.body_text === "string" && body.body_text.trim()
      ? removeDashesFromProse(body.body_text.trim()).slice(0, 4000)
      : removeDashesFromProse(existing.body_text);
    const contentChanged = nextSubject !== existing.subject || nextBody !== existing.body_text;
    patch.subject = nextSubject;
    patch.body_text = nextBody;
    if (body.status === "approved") {
      if (!/(not|won't|will not|do not).{0,20}follow up/i.test(nextBody)) return NextResponse.json({ error: "Keep the simple opt-out line before approving" }, { status: 400 });
      patch.status = "approved";
      patch.approved_at = new Date().toISOString();
      // Approval covers the exact visible words. If those words changed, any
      // previous send slot is invalid and must be queued again deliberately.
      if (contentChanged) patch.scheduled_at = null;
    } else if (contentChanged && existing.status === "approved") {
      // Approval is for the exact words shown. Editing afterwards deliberately
      // returns the message to draft so changed copy cannot bypass review.
      patch.status = "draft";
      patch.approved_at = null;
      patch.scheduled_at = null;
    }
    if (body.status === "draft") { patch.status = "draft"; patch.approved_at = null; patch.scheduled_at = null; }
    const { data, error } = await supabaseAdmin.from("outreach_messages").update(patch).eq("id", params.id).select("*").single();
    if (error) throw error;
    const { data: enrolment, error: enrolmentError } = await supabaseAdmin
      .from("outreach_enrolments")
      .update({
        status: data.status === "approved" ? "approved" : "drafted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.enrolment_id)
      .select("id, status")
      .maybeSingle();
    if (enrolmentError) throw enrolmentError;
    if (!enrolment)
      throw new Error("database did not confirm the campaign enrolment");
    if (data.status === "approved") {
      const { error: eventError } = await supabaseAdmin
        .from("outreach_events")
        .insert({
          campaign_id: data.campaign_id,
          prospect_id: data.prospect_id,
          message_id: data.id,
          kind: "approved",
        });
      if (eventError) throw eventError;
    }
    return NextResponse.json({ message: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to save draft" }, { status: 500 });
  }
}
