import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendOutreachMail, OUTREACH_FROM_EMAIL } from "@/lib/gmail";
import { activeClientDomains, emailDomain, londonDayBounds, OUTREACH_DAILY_HARD_LIMIT, stepDelay } from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const { data: message } = await supabaseAdmin.from("outreach_messages").select("*").eq("id", params.id).single();
    if (!message) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (message.status !== "approved") return NextResponse.json({ error: "Approve this exact draft before sending it" }, { status: 400 });
    if (message.from_email !== OUTREACH_FROM_EMAIL) return NextResponse.json({ error: "Sender safety check failed" }, { status: 400 });
    const [{ data: prospect }, { data: enrolment }, { data: campaign }] = await Promise.all([
      supabaseAdmin.from("outreach_prospects").select("*").eq("id", message.prospect_id).single(),
      supabaseAdmin.from("outreach_enrolments").select("*").eq("id", message.enrolment_id).single(),
      supabaseAdmin.from("outreach_campaigns").select("*").eq("id", message.campaign_id).single(),
    ]);
    if (!prospect || !enrolment || !campaign || campaign.status !== "active") return NextResponse.json({ error: "Campaign or prospect is unavailable" }, { status: 400 });
    if (["replied", "qualified", "not_interested", "suppressed"].includes(prospect.status) || ["replied", "booked", "completed", "suppressed"].includes(enrolment.status)) return NextResponse.json({ error: "Follow-up stopped because this person replied or is suppressed" }, { status: 400 });

    const email = String(prospect.email || "").toLowerCase();
    const domain = String(prospect.company_domain || emailDomain(email)).toLowerCase();
    const { data: blocked } = await supabaseAdmin.from("outreach_suppressions").select("target").in("target", [email, domain]);
    if (blocked?.length) return NextResponse.json({ error: "This person or company is on the do-not-contact list" }, { status: 400 });
    if ((await activeClientDomains()).has(domain)) return NextResponse.json({ error: "This company already exists in the active CRM, outreach was blocked" }, { status: 400 });

    const { start, end } = londonDayBounds();
    const { count } = await supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", start).lt("sent_at", end);
    const dailyLimit = Math.min(OUTREACH_DAILY_HARD_LIMIT, Number(campaign.daily_limit) || 20);
    if ((count || 0) >= dailyLimit) return NextResponse.json({ error: `Daily safety limit reached (${dailyLimit})` }, { status: 429 });

    const sent = await sendOutreachMail({ to: email, subject: message.subject, text: message.body_text });
    if (!sent.ok) {
      await Promise.all([
        supabaseAdmin.from("outreach_messages").update({ status: "failed", error: sent.error, updated_at: new Date().toISOString() }).eq("id", message.id),
        supabaseAdmin.from("outreach_events").insert({ campaign_id: campaign.id, prospect_id: prospect.id, message_id: message.id, kind: "failed", metadata: { error: sent.error } }),
      ]);
      return NextResponse.json({ error: sent.error || "Gmail refused the send" }, { status: 502 });
    }
    const now = new Date();
    const nextStep = Number(message.step_number) + 1;
    const sequence = Array.isArray(campaign.sequence) ? campaign.sequence : [];
    const hasNext = sequence.some((row: any) => Number(row?.step) === nextStep);
    const nextAction = hasNext ? new Date(now.getTime() + stepDelay(sequence, nextStep) * 86400000).toISOString() : null;
    await Promise.all([
      supabaseAdmin.from("outreach_messages").update({ status: "sent", sent_at: now.toISOString(), gmail_message_id: sent.id || null, gmail_thread_id: sent.threadId || null, error: null, updated_at: now.toISOString() }).eq("id", message.id),
      supabaseAdmin.from("outreach_enrolments").update({ status: hasNext ? "contacted" : "completed", current_step: hasNext ? nextStep : message.step_number, last_sent_at: now.toISOString(), next_action_at: nextAction, updated_at: now.toISOString() }).eq("id", enrolment.id),
      supabaseAdmin.from("outreach_prospects").update({ status: "contacted", last_contacted_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", prospect.id),
      supabaseAdmin.from("outreach_events").insert({ campaign_id: campaign.id, prospect_id: prospect.id, message_id: message.id, kind: "sent", metadata: { step: message.step_number, from: OUTREACH_FROM_EMAIL } }),
    ]);
    return NextResponse.json({ ok: true, sentAt: now.toISOString(), remainingToday: Math.max(0, dailyLimit - (count || 0) - 1) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to send email" }, { status: 500 });
  }
}
