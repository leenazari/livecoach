import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { data: existing } = await supabaseAdmin.from("outreach_messages").select("*").eq("id", params.id).single();
    if (!existing || existing.status === "sent") return NextResponse.json({ error: "A sent email cannot be changed" }, { status: 400 });
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    const nextSubject = typeof body.subject === "string" && body.subject.trim() ? body.subject.trim().slice(0, 120) : existing.subject;
    const nextBody = typeof body.body_text === "string" && body.body_text.trim() ? body.body_text.trim().slice(0, 4000) : existing.body_text;
    const contentChanged = nextSubject !== existing.subject || nextBody !== existing.body_text;
    patch.subject = nextSubject;
    patch.body_text = nextBody;
    if (body.status === "approved") {
      if (!/(not|won't|will not|do not).{0,20}follow up/i.test(nextBody)) return NextResponse.json({ error: "Keep the simple opt-out line before approving" }, { status: 400 });
      patch.status = "approved";
      patch.approved_at = new Date().toISOString();
    } else if (contentChanged && existing.status === "approved") {
      // Approval is for the exact words shown. Editing afterwards deliberately
      // returns the message to draft so changed copy cannot bypass review.
      patch.status = "draft";
      patch.approved_at = null;
    }
    if (body.status === "draft") { patch.status = "draft"; patch.approved_at = null; }
    const { data, error } = await supabaseAdmin.from("outreach_messages").update(patch).eq("id", params.id).select("*").single();
    if (error) throw error;
    await supabaseAdmin.from("outreach_enrolments").update({ status: data.status === "approved" ? "approved" : "drafted", updated_at: new Date().toISOString() }).eq("id", data.enrolment_id);
    if (data.status === "approved") await supabaseAdmin.from("outreach_events").insert({ campaign_id: data.campaign_id, prospect_id: data.prospect_id, message_id: data.id, kind: "approved" });
    return NextResponse.json({ message: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to save draft" }, { status: 500 });
  }
}
