import { supabaseAdmin } from "@/lib/supabase";
import { sendConnectedOutreachMail } from "@/lib/mail";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import {
  emailDomain,
  londonDate,
  londonDayBounds,
  OUTREACH_DAILY_HARD_LIMIT,
  outreachCrmGuard,
  prospectHasBlockedCrmRelationship,
  stepDelay,
} from "@/lib/outreach";
import {
  isDeliveryDayConflict,
  isSenderSlotConflict,
  normalizeOutreachCompanySafetyKey,
  outreachSafetyError,
} from "@/lib/outreach-team-safety";

export const OUTREACH_SEND_SPACING_MINUTES = 5;
const SEND_SPACING_MS = OUTREACH_SEND_SPACING_MINUTES * 60 * 1000;
const CLAIM_WINDOW_MS = 10 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 200;

async function reserveOutreachDelivery(
  messageId: string,
  startingAt: Date,
  options: { requireUnscheduled: boolean; claimExpiresAt?: string | null }
) {
  let candidate = new Date(startingAt);
  for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    const scheduledAt = candidate.toISOString();
    let query = supabaseAdmin
      .from("outreach_messages")
      .update({
        scheduled_at: scheduledAt,
        delivery_day: londonDate(candidate),
        claim_expires_at: options.claimExpiresAt ?? null,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .eq("status", "approved");
    if (options.requireUnscheduled) query = query.is("scheduled_at", null);
    const { data, error } = await query
      .select("id,scheduled_at,delivery_day,claim_expires_at")
      .maybeSingle();
    if (!error && data) return data;
    if (!error && options.requireUnscheduled) {
      const { data: current, error: currentError } = await supabaseAdmin
        .from("outreach_messages")
        .select("id,scheduled_at,delivery_day,claim_expires_at")
        .eq("id", messageId)
        .eq("status", "approved")
        .maybeSingle();
      if (currentError) throw currentError;
      if (current?.scheduled_at) return current;
    }
    if (error && isDeliveryDayConflict(error)) {
      candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }
    if (error && isSenderSlotConflict(error)) {
      candidate = new Date(candidate.getTime() + SEND_SPACING_MS);
      continue;
    }
    if (error) {
      const safetyMessage = outreachSafetyError(error);
      if (safetyMessage) throw new Error(safetyMessage);
      throw error;
    }
    break;
  }
  throw new Error("The team outreach calendar has no safe delivery day in the next 30 days");
}

export async function queueApprovedOutreachMessage(messageId: string) {
  const sender = await resolveOutreachIdentity();
  const { data: message, error: messageError } = await supabaseAdmin
    .from("outreach_messages")
    .select("*")
    .eq("id", messageId)
    .single();
  if (messageError || !message) throw new Error("Draft not found");
  if (message.status !== "approved")
    throw new Error("Approve this exact draft before queueing it");
  if (message.sender_user_id !== sender.userId || message.from_email !== sender.senderEmail)
    throw new Error("Sender safety check failed");
  if (message.scheduled_at) {
    return { queued: true, scheduledAt: message.scheduled_at };
  }

  const now = new Date();
  const { data: latest } = await supabaseAdmin
    .from("outreach_messages")
    .select("scheduled_at")
    .eq("status", "approved")
    .eq("sender_user_id", sender.userId)
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
  const queued = await reserveOutreachDelivery(
    messageId,
    new Date(scheduledMs),
    { requireUnscheduled: true }
  );
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
  const scheduledAt = queued.scheduled_at;
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
  const claimExpiresAt = new Date(now.getTime() + CLAIM_WINDOW_MS).toISOString();
  // The claim has its own visibility timeout. Scheduled delivery time remains
  // immutable while the worker runs, so its team-wide delivery-day reservation
  // cannot silently move across midnight.
  const { data: message, error: claimError } = await supabaseAdmin
    .from("outreach_messages")
    .update({
      claim_expires_at: claimExpiresAt,
      updated_at: now.toISOString(),
    })
    .eq("id", messageId)
    .eq("status", "approved")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now.toISOString())
    .or(`claim_expires_at.is.null,claim_expires_at.lte.${now.toISOString()}`)
    .select("*")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!message) return { sent: false, skipped: true };
  const sender = await resolveOutreachIdentity(message.sender_user_id);

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
          claim_expires_at: null,
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

  if (message.from_email !== sender.senderEmail)
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

  const email = String(prospect.email || "").trim().toLowerCase();
  const domain = String(
    prospect.company_domain || emailDomain(email)
  ).toLowerCase();
  const companyKey = normalizeOutreachCompanySafetyKey(prospect);
  if (
    message.recipient_email !== email ||
    message.company_key !== companyKey
  ) {
    await stopClaim("Recipient safety identity changed before send", "failed");
  }
  const { data: blocked } = await supabaseAdmin
    .from("outreach_suppressions")
    .select("target")
    .in("target", [email, domain]);
  if (blocked?.length)
    await stopClaim("This person or company is on the do not contact list");
  if (
    !isReply &&
    prospectHasBlockedCrmRelationship(prospect, await outreachCrmGuard())
  )
    await stopClaim(
      "This CRM relationship is engaged, dormant or not confirmed as a new lead"
    );

  const today = londonDate(now);
  if (message.delivery_day !== today) {
    const reservation = await reserveOutreachDelivery(message.id, now, {
      requireUnscheduled: false,
      claimExpiresAt,
    });
    if (reservation.delivery_day !== today) {
      await supabaseAdmin
        .from("outreach_messages")
        .update({ claim_expires_at: null, updated_at: now.toISOString() })
        .eq("id", message.id);
      return {
        sent: false,
        deferred: true,
        scheduledAt: reservation.scheduled_at,
      };
    }
    message.delivery_day = reservation.delivery_day;
    message.scheduled_at = reservation.scheduled_at;
  }

  const { start, end } = londonDayBounds(now);
  const { count } = await supabaseAdmin
    .from("outreach_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .eq("sender_user_id", sender.userId)
    .gte("sent_at", start)
    .lt("sent_at", end);
  const dailyLimit = Math.min(
    OUTREACH_DAILY_HARD_LIMIT,
    Number(campaign.daily_limit) || 20
  );
  if ((count || 0) >= dailyLimit) {
    const retry = await reserveOutreachDelivery(
      message.id,
      new Date(now.getTime() + 12 * 60 * 60 * 1000),
      { requireUnscheduled: false }
    );
    return { sent: false, deferred: true, scheduledAt: retry.scheduled_at };
  }

  // Claim the irreversible step separately. If the worker stops after Gmail
  // accepts the email but before LiveCoach records the result, the message
  // remains in `sending` for reconciliation instead of being sent twice.
  const { data: sending, error: sendingError } = await supabaseAdmin
    .from("outreach_messages")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", message.id)
    .eq("status", "approved")
    .eq("claim_expires_at", claimExpiresAt)
    .eq("recipient_email", email)
    .eq("company_key", companyKey)
    .select("id,recipient_email,company_key")
    .maybeSingle();
  if (sendingError) throw sendingError;
  if (!sending) return { sent: false, skipped: true };
  if (
    sending.recipient_email !== email ||
    sending.company_key !== companyKey
  ) {
    await stopClaim("Recipient safety identity changed before delivery", "failed");
  }

  const sent = await sendConnectedOutreachMail({
    to: email,
    subject: message.subject,
    text: message.body_text,
    threadId: message.gmail_thread_id || undefined,
    ownerId: sender.userId,
    senderName: sender.senderName,
    fromEmail: sender.senderEmail,
  });
  if (!sent.ok) {
    await Promise.all([
      supabaseAdmin
        .from("outreach_messages")
        .update({
          status: "failed",
          scheduled_at: null,
          claim_expires_at: null,
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
    throw new Error(sent.error || "The connected mailbox refused the send");
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
        claim_expires_at: null,
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
        from: sender.senderEmail,
        senderUserId: sender.userId,
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
