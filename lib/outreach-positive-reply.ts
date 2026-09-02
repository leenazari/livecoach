import "server-only";

import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import {
  ensureOutreachEmailSimpleOptOut,
} from "@/lib/outreach-demo-reply-cta";
import { getPersonalOutreachBookingLink } from "@/lib/outreach-booking-link";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { modelText, parseObject } from "@/lib/outreach";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import {
  estimatedVoiceSeconds,
  normaliseOutreachVoiceScript,
} from "@/lib/outreach-voice-note";
import { getOptionalSalesProfile } from "@/lib/sales-profile";
import { supabaseService } from "@/lib/supabase";
import { logModelUsage } from "@/lib/usage";

type Scope = { userId: string; workspaceId: string };

const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

const clean = (value: unknown, maximum: number) =>
  removeDashesFromProse(String(value || "").trim()).slice(0, maximum);

export async function preparePositiveReplyForApproval(
  scope: Scope,
  prospectId: string
) {
  const sender = await resolveOutreachIdentity(scope.userId);
  const [{ data: prospect, error: prospectError }, { data: enrolments, error: enrolmentError }] =
    await Promise.all([
      supabaseService
        .from("outreach_prospects")
        .select("*")
        .eq("workspace_id", scope.workspaceId)
        .eq("assigned_to_user_id", scope.userId)
        .eq("id", prospectId)
        .maybeSingle(),
      supabaseService
        .from("outreach_enrolments")
        .select("*")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
  if (prospectError) throw prospectError;
  if (enrolmentError) throw enrolmentError;
  const enrolment = enrolments?.[0];
  if (!prospect || !enrolment) throw fail(404, "Outreach relationship not found");
  if (prospect.reply_category !== "interested") {
    throw fail(400, "A booking reply is only prepared after a positive response");
  }

  const [
    { data: campaign, error: campaignError },
    { data: lastSent, error: lastSentError },
    { data: existingReply, error: existingReplyError },
    bookingUrl,
    personalProfile,
  ] = await Promise.all([
    supabaseService
      .from("outreach_campaigns")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", enrolment.campaign_id)
      .maybeSingle(),
    supabaseService
      .from("outreach_messages")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("sender_user_id", scope.userId)
      .eq("prospect_id", prospect.id)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseService
      .from("outreach_messages")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("sender_user_id", scope.userId)
      .eq("enrolment_id", enrolment.id)
      .eq("step_number", 10)
      .maybeSingle(),
    getPersonalOutreachBookingLink(scope),
    getOptionalSalesProfile(scope),
  ]);
  if (campaignError) throw campaignError;
  if (lastSentError) throw lastSentError;
  if (existingReplyError) throw existingReplyError;
  if (!campaign) throw fail(404, "Outreach campaign not found");
  if (
    existingReply &&
    ["draft", "approved", "failed"].includes(existingReply.status)
  ) {
    return { message: existingReply, reused: true };
  }
  if (["sending", "sent"].includes(existingReply?.status)) {
    throw fail(409, "A reply has already been sent for this response");
  }
  if (campaign.booking_cta_mode === "never") {
    throw fail(400, "This campaign is set not to include booking links");
  }
  if (!bookingUrl) {
    throw fail(400, "Add your personal booking link in My Sales Setup first");
  }

  const voice =
    campaign.voice && typeof campaign.voice === "object" ? campaign.voice : {};
  const emailSignoff =
    personalProfile.emailSignoff || sender.senderName.split(" ")[0];
  const firstName = clean(prospect.first_name || "there", 80) || "there";
  const message = await openai.messages.create(
    {
      model: OPENAI_MODEL_PRO,
      max_tokens: 800,
      system: `Prepare two approval ready responses from ${sender.senderName} after a positive B2B reply about Interviewa. Return only JSON with subject, bodyText, voiceScript and reasoning. The email must acknowledge only what the person actually said, use the exact booking link once, contain 35 to 90 words, use short paragraphs, one clear next step, and be signed exactly "${emailSignoff}". End gently with "If the timing is not right, no problem and I won't follow up." The separate voice script must sound welcoming, upbeat, positive and natural. Start exactly "Hi ${firstName}, I hope you are doing well today." The opening must use the same steady conversational cadence as the rest, without a long pause. Aim for 80 to 120 words. Do not read out the booking URL, email opt out or subject. The synthetic voice must not claim to be ${sender.senderName}. Use "We are Interviewa" if the brand needs introducing. Use British English. Do not use hyphens, dashes or semicolons. Never invent what the recipient said, their needs, facts, results or urgency.`,
      messages: [
        {
          role: "user",
          content: `PERSON: ${prospect.first_name || ""} ${prospect.last_name || ""}, ${prospect.job_title || ""} at ${prospect.company_name || ""}\nTHEIR REPLY:\n${prospect.last_reply_text || prospect.reply_summary || "Positive reply received."}\nOUR PREVIOUS SUBJECT: ${lastSent?.subject || "Interviewa"}\nSAVED RESEARCH: ${JSON.stringify(enrolment.research || prospect.research || {}).slice(0, 2200)}\nBOOKING LINK: ${bookingUrl}`,
        },
      ],
    },
    { timeout: 35_000 }
  );
  await logModelUsage(
    "outreach_booking_reply",
    "pro",
    message?.usage,
    { prospectId: prospect.id, campaignId: campaign.id },
    scope
  );
  const parsed = parseObject(modelText(message));
  const subject = clean(
    parsed?.subject || `Re: ${lastSent?.subject || "Interviewa"}`,
    120
  );
  const bodyText = ensureOutreachEmailSimpleOptOut({
    body: clean(parsed?.bodyText, 4000),
    signoff: emailSignoff,
    maximumCharacters: 4000,
  });
  const voiceScript = normaliseOutreachVoiceScript(
    clean(parsed?.voiceScript, 1200)
  );
  if (!bodyText || !bodyText.includes(bookingUrl)) {
    throw fail(502, "The booking reply did not pass its link check, try again");
  }
  if (!voiceScript || !voiceScript.startsWith(`Hi ${firstName},`)) {
    throw fail(502, "The voice reply did not pass its opening check, try again");
  }
  const strategy = {
    messageType: "reply",
    reasoning: clean(
      parsed?.reasoning || "Positive reply with a simple booking next step.",
      500
    ),
    angle: "booking",
    tone: clean(voice.tone || "warm and concise", 180),
    cta: "book a suitable time",
    persona: clean(prospect.job_title || "buyer", 180),
    replyReceivedAt: prospect.last_reply_at,
  };
  const now = new Date().toISOString();
  const { data: draft, error: draftError } = await supabaseService
    .from("outreach_messages")
    .upsert(
      {
        enrolment_id: enrolment.id,
        campaign_id: campaign.id,
        prospect_id: prospect.id,
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        visibility: "team",
        step_number: 10,
        variant: "reply",
        from_email: sender.senderEmail,
        sender_user_id: scope.userId,
        subject,
        body_text: bodyText,
        preview_text: "",
        status: "draft",
        gmail_thread_id:
          String(prospect.reply_thread_id || "").startsWith("sendpilot:")
            ? null
            : prospect.reply_thread_id || lastSent?.gmail_thread_id || null,
        strategy,
        quality_score: 95,
        message_tags: {
          angle: "booking",
          tone: strategy.tone,
          cta: strategy.cta,
          persona: strategy.persona,
          step: 10,
          variant: "reply",
          source: "positive_reply",
        },
        booking_link_included: true,
        voice_script: voiceScript,
        voice_status: "script_ready",
        voice_audio_path: null,
        voice_audio_mime: null,
        voice_generated_at: null,
        voice_script_hash: null,
        voice_model_id: null,
        voice_provider_voice_id: null,
        voice_provider_request_id: null,
        voice_estimated_seconds: estimatedVoiceSeconds(voiceScript),
        voice_character_count: null,
        voice_estimated_cost_gbp: null,
        voice_error: null,
        voice_script_approved_at: null,
        voice_script_approved_by: null,
        voice_script_approved_hash: null,
        updated_at: now,
      },
      { onConflict: "enrolment_id,step_number" }
    )
    .select("*")
    .single();
  if (draftError) throw draftError;
  const { error: eventError } = await supabaseService.from("outreach_events").insert({
    workspace_id: scope.workspaceId,
    owner_id: scope.userId,
    visibility: "team",
    campaign_id: campaign.id,
    prospect_id: prospect.id,
    message_id: draft.id,
    kind: "drafted",
    metadata: {
      messageType: "reply",
      booking: true,
      voiceScript: true,
      replyReceivedAt: prospect.last_reply_at,
    },
  });
  if (eventError) throw eventError;
  return { message: draft, reused: false };
}
