import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { modelText, parseObject } from "@/lib/outreach";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { getPersonalOutreachBookingLink } from "@/lib/outreach-booking-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sender = await resolveOutreachIdentity();
    if (!UUID.test(params.id))
      return NextResponse.json({ error: "Outreach relationship not found" }, { status: 404 });
    const [{ data: prospect }, { data: enrolments }] = await Promise.all([
      supabaseAdmin
        .from("outreach_prospects")
        .select("*")
        .eq("workspace_id", sender.workspaceId)
        .eq("assigned_to_user_id", sender.userId)
        .eq("id", params.id)
        .maybeSingle(),
      supabaseAdmin
        .from("outreach_enrolments")
        .select("*")
        .eq("workspace_id", sender.workspaceId)
        .eq("owner_id", sender.userId)
        .eq("prospect_id", params.id)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const enrolment = enrolments?.[0];
    if (!prospect || !enrolment) return NextResponse.json({ error: "Outreach relationship not found" }, { status: 404 });
    if (prospect.reply_category !== "interested") return NextResponse.json({ error: "A booking reply is only prepared after a positive response" }, { status: 400 });
    const [
      { data: campaign },
      { data: lastSent },
      { data: existingReply },
      bookingUrl,
    ] = await Promise.all([
      supabaseAdmin
        .from("outreach_campaigns")
        .select("*")
        .eq("workspace_id", sender.workspaceId)
        .eq("id", enrolment.campaign_id)
        .maybeSingle(),
      supabaseAdmin
        .from("outreach_messages")
        .select("*")
        .eq("workspace_id", sender.workspaceId)
        .eq("sender_user_id", sender.userId)
        .eq("prospect_id", prospect.id)
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("outreach_messages")
        .select("*")
        .eq("workspace_id", sender.workspaceId)
        .eq("enrolment_id", enrolment.id)
        .eq("step_number", 10)
        .maybeSingle(),
      getPersonalOutreachBookingLink({
        userId: sender.userId,
        workspaceId: sender.workspaceId,
      }),
    ]);
    if (!campaign)
      return NextResponse.json({ error: "Outreach campaign not found" }, { status: 404 });
    if (existingReply && existingReply.sender_user_id !== sender.userId)
      return NextResponse.json(
        { error: "This reply thread belongs to another teammate and needs a safe reassignment first" },
        { status: 409 }
      );
    if (
      existingReply &&
      ["draft", "approved", "failed"].includes(existingReply.status)
    ) {
      return NextResponse.json({ message: existingReply, reused: true });
    }
    if (existingReply?.status === "sent")
      return NextResponse.json(
        { error: "A reply has already been sent for this response" },
        { status: 409 }
      );
    if (campaign.booking_cta_mode === "never")
      return NextResponse.json(
        { error: "This campaign is set not to include booking links" },
        { status: 400 }
      );
    if (!bookingUrl)
      return NextResponse.json(
        { error: "Add your personal booking link in My Sales Setup first" },
        { status: 400 }
      );
    const voice = campaign?.voice && typeof campaign.voice === "object" ? campaign.voice : {};
    const msg = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 500,
      system: `Draft ${sender.senderName}'s reply to a positive B2B response about Interviewa. The purpose is to acknowledge what they actually said and make booking easy, without restarting the pitch. British English. Tone: ${voice.tone || "warm, commercially curious and concise"}. Style: ${voice.style || "natural and commercially curious"}. Use the exact booking link once. Keep it 35 to 90 words, short paragraphs, one clear next step, signed "${voice.signature || sender.senderName.split(" ")[0]}". Never use a hyphen, dash or em dash in prose, even when grammar normally calls for one. Write "better prepared", never "better-prepared". End gently with "If the timing is not right, no problem and I won't follow up." Never invent what they said or claim a need they did not state. Return ONLY JSON: {"subject":"...","bodyText":"...","reasoning":"why this reply fits, max 35 words"}.`,
      messages: [{ role: "user", content: `PERSON: ${prospect.first_name || ""} ${prospect.last_name || ""}, ${prospect.job_title || ""} at ${prospect.company_name}\nTHEIR REPLY:\n${prospect.last_reply_text || prospect.reply_summary || "Positive reply received."}\nOUR PREVIOUS SUBJECT: ${lastSent?.subject || "Interviewa"}\nSAVED RESEARCH: ${JSON.stringify(enrolment.research || prospect.research || {}).slice(0, 2200)}\nBOOKING LINK: ${bookingUrl}` }],
    }, { timeout: 35_000 });
    await logModelUsage(
      "outreach_booking_reply",
      "pro",
      msg?.usage,
      { prospectId: prospect.id, campaignId: campaign.id },
      { userId: sender.userId, workspaceId: sender.workspaceId }
    );
    const parsed = parseObject(modelText(msg));
    const subject = removeDashesFromProse(String(parsed?.subject || `Re: ${lastSent?.subject || "Interviewa"}`).trim()).slice(0, 120);
    const bodyText = removeDashesFromProse(String(parsed?.bodyText || "").trim()).slice(0, 4000);
    if (!bodyText || !bodyText.includes(bookingUrl)) return NextResponse.json({ error: "The booking reply did not pass its link check, try again" }, { status: 502 });
    const strategy = { messageType: "reply", reasoning: String(parsed?.reasoning || "Positive reply with a simple booking next step.").slice(0, 500), angle: "booking", tone: String(voice.tone || "warm and concise"), cta: "book a suitable time", persona: prospect.job_title || "buyer" };
    const { data: draft, error } = await supabaseAdmin.from("outreach_messages").upsert({
      enrolment_id: enrolment.id,
      campaign_id: campaign.id,
      prospect_id: prospect.id,
      workspace_id: sender.workspaceId,
      owner_id: sender.userId,
      visibility: "team",
      step_number: 10,
      variant: "reply",
      from_email: sender.senderEmail,
      sender_user_id: sender.userId,
      subject,
      body_text: bodyText,
      preview_text: "",
      status: "draft",
      gmail_thread_id: prospect.reply_thread_id || lastSent?.gmail_thread_id || null,
      strategy,
      quality_score: 95,
      message_tags: { angle: "booking", tone: strategy.tone, cta: strategy.cta, persona: strategy.persona, step: 10, variant: "reply" },
      booking_link_included: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "enrolment_id,step_number" }).select("*").single();
    if (error) throw error;
    await supabaseAdmin.from("outreach_events").insert({
      workspace_id: sender.workspaceId,
      owner_id: sender.userId,
      visibility: "team",
      campaign_id: campaign.id,
      prospect_id: prospect.id,
      message_id: draft.id,
      kind: "drafted",
      metadata: { messageType: "reply", booking: true },
    });
    return NextResponse.json({ message: draft });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to prepare booking reply" }, { status: 500 });
  }
}
