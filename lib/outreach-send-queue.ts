import { supabaseAdmin } from "@/lib/supabase";
import { sendOutreachMail, OUTREACH_FROM_EMAIL } from "@/lib/gmail";
import {
  activeClientDomains,
  emailDomain,
  londonDayBounds,
  OUTREACH_DAILY_HARD_LIMIT,
  stepDelay,
} from "@/lib/outreach";

export const OUTREACH_SEND_SPACING_MINUTES = 5;
const SEND_SPACING_MS = OUTREACH_SEND_SPACING_MINUTES * 60 * 1000;
const CLAIM_WINDOW_MS = 10 * 60 * 1000;

export async function queueApprovedOutreachMessage(messageId: string) {
  const { data: message, error: messageError } = await supabaseAdmin
    .from("outreach_messages")
    .select("*")
    .eq("id", messageId)
    .single();
  if (messageError || !message) throw new Error("Draft not found");
  if (message.status !== "approved")
    throw new Error("Approve this exact draft before queueing it");
  if (message.from_email !== OUTREACH_FROM_EMAIL)
    throw new Error("Sender safety check failed");
  if (message.scheduled_at) {
    return { queued: true, scheduledAt: message.scheduled_at };
  }

  const now = new Date();
  const { data: latest } = await supabaseAdmin
    .from("outreach_messages")
    .select("scheduled_at")
    .eq("status", "approved")
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestMs = latest?.scheduled_at
    ? new Date(latest.scheduled_at).getTime()
    : 0;
  const earliestMs = now.getTime() + 60 * 1000;
  const afterLatestMs = latestMs ? latestMs + SEND_SPACING_MS : 0;
  const scheduledMs =
    Math.ceil(Math.max(earliestMs, afterLatestMs) / SEND_SPACING_MS) *
    SEND_SPACING_MS;
  const scheduledAt = new Date(scheduledMs).toISOString();

  const { data: queued, error } = await supabaseAdmin
    .from("outreach_messages")
    .update({ scheduled_at: scheduledAt, error: null, updated_at: now.toISOString() })
    .eq("id", messageId)
    .eq("status", "approved")
    .is("scheduled_at", null)
    .select("id, scheduled_at")
    .maybeSingle();
  if (error) throw error;
  if (!queued) {
    const { data: current } = await supabaseAdmin
      .from("outreach_messages")
      .select("scheduled_at")
      .eq("id", messageId)
      .single();
    if (!current?.scheduled_at)
      throw new Error("The database did not confirm the send queue");
    return { queued: true, scheduledAt: current.scheduled_at };
  }
  await supabaseAdmin.from("outreach_events").insert({
    campaign_id: message.campaign_id,
    prospect_id: message.prospect_id,
    message_id: message.id,
    kind: "queued",
    metadata: {
      scheduledAt,
      spacingMinutes: OUTREACH_SEND_SPACING_MINUTES,
      action: "approved_send",
    },
  });
  return { queued: true, scheduledAt };
}

export async function dispatchDueOutreachMessage(messageId: string) {
  const now = new Date();
  // Move the due time forward before sending. A second overlapping cron run can
  // no longer claim the same row, while a crashed worker becomes eligible again.
  const { data: message, error: claimError } = await supabaseAdmin
    .from("outreach_messages")
    .update({
      scheduled_at: new Date(now.getTime() + CLAIM_WINDOW_MS).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", messageId)
    .eq("status", "approved")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now.toISOString())
    .select("*")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!message) return { sent: false, skipped: true };

  const stopClaim = async (
    reason: string,
    status: "failed" | "cancelled" = "cancelled"
  ): Promise<never> => {
    await Promise.all([
      supabaseAdmin
        .from("outreach_messages")
        .update({
          status,
          scheduled_at: null,
          error: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", message.id),
      supabaseAdmin.from("outreach_events").insert({
        campaign_id: message.campaign_id,
        prospect_id: message.prospect_id,
        message_id: message.id,
        kind: "failed",
        metadata: { error: reason, stoppedBeforeSend: true },
      }),
    ]);
    throw new Error(reason);
  };

  if (message.from_email !== OUTREACH_FROM_EMAIL)
    await stopClaim("Sender safety check failed", "failed");
  const [{ data: prospect }, { data: enrolment }, { data: campaign }] =
    await Promise.all([
      supabaseAdmin
        .from("outreach_prospects")
        .select("*")
        .eq("id", message.prospect_id)
        .single(),
      supabaseAdmin
        .from("outreach_enrolments")
        .select("*")
        .eq("id", message.enrolment_id)
        .single(),
      supabaseAdmin
        .from("outreach_campaigns")
        .select("*")
        .eq("id", message.campaign_id)
        .single(),
    ]);
  if (!prospect || !enrolment || !campaign || campaign.status !== "active")
    await stopClaim("Campaign or prospect is unavailable", "failed");
  const isReply = message.strategy?.messageType === "reply";
  if (
    !isReply &&
    (["replied", "qualified", "not_interested", "suppressed"].includes(
      prospect.status
    ) ||
      ["replied", "booked", "completed", "suppressed"].includes(
        enrolment.status
      ))
  )
    await stopClaim("Follow up stopped because this person replied or is suppressed");
  if (isReply && prospect.reply_category !== "interested")
    await stopClaim("This booking reply is no longer appropriate");
  if (
    ["suppressed", "not_interested"].includes(prospect.status) ||
    enrolment.status === "suppressed"
  )
    await stopClaim("This person is suppressed");

  const email = String(prospect.email || "").toLowerCase();
  const domain = String(
    prospect.company_domain || emailDomain(email)
  ).toLowerCase();
  const { data: blocked } = await supabaseAdmin
    .from("outreach_suppressions")
    .select("target")
    .in("target", [email, domain]);
  if (blocked?.length)
    await stopClaim("This person or company is on the do not contact list");
  if (!isReply && (await activeClientDomains()).has(domain))
    await stopClaim("This company already exists in the active CRM, outreach was blocked");

  const { start, end } = londonDayBounds(now);
  const { count } = await supabaseAdmin
    .from("outreach_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", start)
    .lt("sent_at", end);
  const dailyLimit = Math.min(
    OUTREACH_DAILY_HARD_LIMIT,
    Number(campaign.daily_limit) || 20
  );
  if ((count || 0) >= dailyLimit) {
    const retryAt = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("outreach_messages")
      .update({ scheduled_at: retryAt, updated_at: now.toISOString() })
      .eq("id", message.id);
    return { sent: false, deferred: true, scheduledAt: retryAt };
  }

  const sent = await sendOutreachMail({
    to: email,
    subject: message.subject,
    text: message.body_text,
    threadId: message.gmail_thread_id || undefined,
  });
  if (!sent.ok) {
    await Promise.all([
      supabaseAdmin
        .from("outreach_messages")
        .update({
          status: "failed",
          scheduled_at: null,
          error: sent.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", message.id),
      supabaseAdmin.from("outreach_events").insert({
        campaign_id: campaign.id,
        prospect_id: prospect.id,
        message_id: message.id,
        kind: "failed",
        metadata: { error: sent.error },
      }),
    ]);
    throw new Error(sent.error || "Gmail refused the send");
  }

  const sentAt = new Date();
  const nextStep = Number(message.step_number) + 1;
  const sequence = Array.isArray(campaign.sequence) ? campaign.sequence : [];
  const hasNext =
    !isReply &&
    sequence.some((row: any) => Number(row?.step) === nextStep);
  const nextAction = hasNext
    ? new Date(
        sentAt.getTime() + stepDelay(sequence, nextStep) * 86400000
      ).toISOString()
    : null;
  await Promise.all([
    supabaseAdmin
      .from("outreach_messages")
      .update({
        status: "sent",
        scheduled_at: null,
        sent_at: sentAt.toISOString(),
        gmail_message_id: sent.id || null,
        gmail_thread_id: sent.threadId || null,
        error: null,
        updated_at: sentAt.toISOString(),
      })
      .eq("id", message.id),
    supabaseAdmin
      .from("outreach_enrolments")
      .update({
        status: isReply ? "replied" : hasNext ? "contacted" : "completed",
        current_step: isReply
          ? enrolment.current_step
          : hasNext
            ? nextStep
            : message.step_number,
        last_sent_at: sentAt.toISOString(),
        next_action_at: nextAction,
        updated_at: sentAt.toISOString(),
      })
      .eq("id", enrolment.id),
    supabaseAdmin
      .from("outreach_prospects")
      .update({
        status: isReply ? "qualified" : "contacted",
        last_contacted_at: sentAt.toISOString(),
        updated_at: sentAt.toISOString(),
      })
      .eq("id", prospect.id),
    supabaseAdmin.from("outreach_events").insert({
      campaign_id: campaign.id,
      prospect_id: prospect.id,
      message_id: message.id,
      kind: "sent",
      metadata: {
        step: message.step_number,
        from: OUTREACH_FROM_EMAIL,
        messageType: isReply ? "reply" : "sequence",
        tags: message.message_tags || {},
      },
    }),
    ...(message.booking_link_included
      ? [
          supabaseAdmin.from("outreach_events").insert({
            campaign_id: campaign.id,
            prospect_id: prospect.id,
            message_id: message.id,
            kind: "booking_link_shared",
            metadata: { step: message.step_number },
          }),
        ]
      : []),
  ]);
  return {
    sent: true,
    sentAt: sentAt.toISOString(),
    remainingToday: Math.max(0, dailyLimit - (count || 0) - 1),
  };
}
