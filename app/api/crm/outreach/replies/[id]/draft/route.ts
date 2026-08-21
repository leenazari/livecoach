import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { modelText, parseObject } from "@/lib/outreach";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import { getAppConfigValue } from "@/lib/app-config";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sender = await resolveOutreachIdentity();
    const [{ data: prospect }, { data: enrolments }] = await Promise.all([
      supabaseAdmin.from("outreach_prospects").select("*").eq("id", params.id).single(),
      supabaseAdmin.from("outreach_enrolments").select("*").eq("prospect_id", params.id).order("created_at", { ascending: false }).limit(1),
    ]);
    const enrolment = enrolments?.[0];
    if (!prospect || !enrolment) return NextResponse.json({ error: "Outreach relationship not found" }, { status: 404 });
    if (prospect.assigned_to_user_id !== sender.userId)
      return NextResponse.json({ error: "This prospect belongs to another team member" }, { status: 403 });
    if (prospect.reply_category !== "interested") return NextResponse.json({ error: "A booking reply is only prepared after a positive response" }, { status: 400 });
    const [{ data: campaign }, { data: lastSent }, { data: globalBooking }] = await Promise.all([
      supabaseAdmin.from("outreach_campaigns").select("*").eq("id", enrolment.campaign_id).single(),
      supabaseAdmin.from("outreach_messages").select("*").eq("prospect_id", prospect.id).eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
      getAppConfigValue("outreach_default_booking_url").then((data) => ({ data })),
    ]);
    const bookingUrl = String(campaign?.booking_url || globalBooking?.value || "").trim();
    if (!bookingUrl) return NextResponse.json({ error: "Add your AI13 booking link in the Intelligence tab first" }, { status: 400 });
    const voice = campaign?.voice && typeof campaign.voice === "object" ? campaign.voice : {};
    const msg = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 500,
      system: `Draft ${sender.senderName}'s reply to a positive B2B response about Interviewa. The purpose is to acknowledge what they actually said and make booking easy, without restarting the pitch. British English. Tone: ${voice.tone || "warm, commercially curious and concise"}. Style: ${voice.style || "natural and commercially curious"}. Use the exact booking link once. Keep it 35 to 90 words, short paragraphs, one clear next step, signed "${voice.signature || sender.senderName.split(" ")[0]}". Never use a hyphen, dash or em dash in prose, even when grammar normally calls for one. Write "better prepared", never "better-prepared". End gently with "If the timing is not right, no problem and I won't follow up." Never invent what they said or claim a need they did not state. Return ONLY JSON: {"subject":"...","bodyText":"...","reasoning":"why this reply fits, max 35 words"}.`,
      messages: [{ role: "user", content: `PERSON: ${prospect.first_name || ""} ${prospect.last_name || ""}, ${prospect.job_title || ""} at ${prospect.company_name}\nTHEIR REPLY:\n${prospect.last_reply_text || prospect.reply_summary || "Positive reply received."}\nOUR PREVIOUS SUBJECT: ${lastSent?.subject || "Interviewa"}\nSAVED RESEARCH: ${JSON.stringify(enrolment.research || prospect.research || {}).slice(0, 2200)}\nBOOKING LINK: ${bookingUrl}` }],
    }, { timeout: 35_000 });
    await logModelUsage("outreach_booking_reply", "pro", msg?.usage);
    const parsed = parseObject(modelText(msg));
    const subject = removeDashesFromProse(String(parsed?.subject || `Re: ${lastSent?.subject || "Interviewa"}`).trim()).slice(0, 120);
    const bodyText = removeDashesFromProse(String(parsed?.bodyText || "").trim()).slice(0, 4000);
    if (!bodyText || !bodyText.includes(bookingUrl)) return NextResponse.json({ error: "The booking reply did not pass its link check, try again" }, { status: 502 });
    const strategy = { messageType: "reply", reasoning: String(parsed?.reasoning || "Positive reply with a simple booking next step.").slice(0, 500), angle: "booking", tone: String(voice.tone || "warm and concise"), cta: "book a suitable time", persona: prospect.job_title || "buyer" };
    const { data: draft, error } = await supabaseAdmin.from("outreach_messages").upsert({
      enrolment_id: enrolment.id,
      campaign_id: campaign.id,
      prospect_id: prospect.id,
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
    await supabaseAdmin.from("outreach_events").insert({ campaign_id: campaign.id, prospect_id: prospect.id, message_id: draft.id, kind: "drafted", metadata: { messageType: "reply", booking: true } });
    return NextResponse.json({ message: draft });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to prepare booking reply" }, { status: 500 });
  }
}
