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
  outreach_one_active_campaign_per_contact:
    "This person is already active in another campaign. Open their existing outreach history instead.",
  outreach_one_company_per_queue_day:
    "Another teammate already has someone from this company in the team queue today.",
  outreach_one_approved_message_per_contact:
    "Another approved email already exists for this person. Review that email before approving another.",
  outreach_one_recipient_per_delivery_day:
    "This person already has an email reserved for that day.",
  outreach_one_company_per_delivery_day:
    "Another teammate already has an email to this company reserved for that day.",
  outreach_one_sender_per_send_slot:
    "Another email already has this sender's delivery slot.",
  outreach_cross_campaign_cooldown:
    "This person was contacted through another campaign within the last 30 days. A workspace owner or manager may override this safety pause with a recorded reason.",
};

const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.co.uk",
  "hotmail.com",
  "icloud.com",
  "live.co.uk",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.co.uk",
  "yahoo.com",
]);

export function isActiveOutreachEnrolmentStatus(value: unknown): boolean {
  return (ACTIVE_OUTREACH_ENROLMENT_STATUSES as readonly string[]).includes(
    String(value || "")
  );
}

export function normalizeOutreachCompanySafetyKey(prospect: any): string {
  let domain = String(prospect?.company_domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
  if (domain) return `domain:${domain}`;

  const email = String(prospect?.email || "").trim().toLowerCase();
  const emailDomain = email.split("@")[1] || "";
  if (emailDomain && !PERSONAL_EMAIL_DOMAINS.has(emailDomain)) {
    return `domain:${emailDomain}`;
  }

  const companyId = String(prospect?.crm_company_id || "").trim();
  if (companyId) return `crm:${companyId.toLowerCase()}`;

  const companyName = String(prospect?.company_name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (companyName) return `name:${companyName}`;

  return email ? `contact:${email}` : "";
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
  return (
    haystack.includes("outreach_one_company_per_delivery_day") ||
    haystack.includes("outreach_one_recipient_per_delivery_day")
  );
}

export function isSenderSlotConflict(error: any): boolean {
  const haystack = [error?.constraint, error?.message, error?.details]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("outreach_one_sender_per_send_slot");
}
