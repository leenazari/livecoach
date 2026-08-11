export const PIPELINE_STAGES = [
  "new",
  "discovery",
  "qualified",
  "proposal",
  "negotiation",
  "verbal",
  "won",
  "lost",
] as const;

export const WIN_OUTLOOKS = [
  "not_assessed",
  "at_risk",
  "possible",
  "likely",
  "highly_likely",
  "won",
] as const;

export const ENGAGEMENT_MOTIONS = [
  "cold_outreach_campaign",
  "personal_relationship_led",
  "existing_customer_expansion",
  "inbound_enquiry",
  "partner_referral",
] as const;

export const CONTACT_METHODS = [
  "automated_email",
  "personal_email",
  "phone",
  "video_call",
  "linkedin",
  "event",
  "in_person",
  "other",
] as const;

export type WinOutlook = (typeof WIN_OUTLOOKS)[number];

export const WIN_OUTLOOK_LABELS: Record<WinOutlook, string> = {
  not_assessed: "Not assessed",
  at_risk: "At risk",
  possible: "Possible",
  likely: "Likely",
  highly_likely: "Highly likely",
  won: "Won",
};

export const cleanStringList = (value: unknown, limit = 8, length = 240) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && !!item.trim())
        .map((item) => item.trim().slice(0, length))
        .slice(0, limit)
    : [];

export const defaultOutlookQuestions = (opportunity: Record<string, any>) => {
  const questions: string[] = [];
  if (!opportunity.value) questions.push("What level of usage would define the commercial value?");
  if (!opportunity.expected_close_at) questions.push("What decision date is the buyer working towards?");
  if (!opportunity.next_action) questions.push("What exact mutual next step will move this forward?");
  if (!opportunity.win_outlook_reasons?.length)
    questions.push("What evidence shows urgency, authority and commitment to change?");
  return questions.slice(0, 4);
};
