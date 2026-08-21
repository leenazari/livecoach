import "server-only";

export const OUTREACH_CROSS_CAMPAIGN_COOLDOWN_DAYS = 30;

export const ACTIVE_OUTREACH_ENROLMENT_STATUSES = [
  "queued",
  "researched",
  "drafted",
  "approved",
  "contacted",
  "replied",
  "booked",
  "paused",
] as const;

const SAFETY_CONSTRAINT_MESSAGES: Record<string, string> = {
  outreach_one_active_campaign_per_recipient_email:
    "This email address is already active in another campaign. Open its existing outreach history instead.",
  outreach_one_approved_message_per_recipient_email:
    "Another approved email already exists for this address. Review that email before approving another.",
  outreach_one_recipient_per_delivery_day:
    "This email address already has a message reserved for that day.",
  outreach_one_sender_per_send_slot:
    "Another email already has this sender's delivery slot.",
  outreach_cross_campaign_cooldown:
    "This email address was contacted through another campaign within the last 30 days. A workspace owner or manager may override this safety pause with a recorded reason.",
};

export function isActiveOutreachEnrolmentStatus(value: unknown): boolean {
  return (ACTIVE_OUTREACH_ENROLMENT_STATUSES as readonly string[]).includes(
    String(value || "")
  );
}

export function isInsideCrossCampaignCooldown(
  lastSentAt: unknown,
  now = new Date()
): boolean {
  const sentAt = new Date(String(lastSentAt || ""));
  if (Number.isNaN(sentAt.getTime())) return false;
  return (
    sentAt.getTime() >
    now.getTime() - OUTREACH_CROSS_CAMPAIGN_COOLDOWN_DAYS * 86400000
  );
}

export function outreachSafetyError(error: any): string | null {
  const haystack = [
    error?.constraint,
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const [constraint, message] of Object.entries(
    SAFETY_CONSTRAINT_MESSAGES
  )) {
    if (haystack.includes(constraint.toLowerCase())) return message;
  }
  if (haystack.includes("30 day cross campaign safety pause")) {
    return SAFETY_CONSTRAINT_MESSAGES.outreach_cross_campaign_cooldown;
  }
  return null;
}

export function isDeliveryDayConflict(error: any): boolean {
  const haystack = [error?.constraint, error?.message, error?.details]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("outreach_one_recipient_per_delivery_day");
}

export function isSenderSlotConflict(error: any): boolean {
  const haystack = [error?.constraint, error?.message, error?.details]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("outreach_one_sender_per_send_slot");
}
