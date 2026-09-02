export type OutreachCampaignRole = "owner" | "manager" | "sales";
export type OutreachCampaignMemberStatus =
  | "active"
  | "onboarding"
  | "suspended"
  | "removed";

export const OUTREACH_CAMPAIGN_CONTENT_FIELDS = [
  "goal",
  "audience",
  "offer_angle",
  "sequence",
  "voice",
  "banned_phrases",
  "booking_cta_mode",
  "cta_config",
] as const;

export const OUTREACH_CAMPAIGN_CONTROL_FIELDS = [
  "name",
  "status",
  "daily_limit",
] as const;

export function outreachCampaignPermissions(input: {
  role: OutreachCampaignRole;
  memberStatus: OutreachCampaignMemberStatus;
  campaignVisibility?: unknown;
}) {
  const active = input.memberStatus === "active";
  const canManageCampaign =
    active && (input.role === "owner" || input.role === "manager");
  const canEditCampaignContent =
    active &&
    (canManageCampaign || String(input.campaignVisibility || "") === "team");

  return {
    canEditCampaignContent,
    canManageCampaign,
  };
}
