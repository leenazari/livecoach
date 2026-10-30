type Campaign = { id: string; status: string };
type Prospect = {
  id?: string;
  outreach?: {
    campaignIds?: string[];
    enrolment?: { campaign_id?: string } | null;
  };
};

// A proposed campaign for a fresh lead is not membership. In particular it
// must never be passed to call logging as if the lead were already enrolled.
export function prospectCampaignChoice<T extends Campaign>(
  prospect: Prospect,
  campaigns: T[],
  proposedCampaignId?: string
) {
  const savedId = prospect.outreach?.enrolment?.campaign_id;
  const ids = [...new Set([...(prospect.outreach?.campaignIds || []), savedId].filter(Boolean))];
  const existingCampaign = campaigns.find((row) => row.id === savedId && row.status === "active") ||
    campaigns.find((row) => ids.includes(row.id) && row.status === "active") || null;
  const needsCampaign = ids.length === 0;
  const campaign = existingCampaign || (needsCampaign
    ? campaigns.find((row) => row.id === proposedCampaignId && row.status === "active") || null
    : null);
  return {
    campaign,
    needsCampaign,
    // Preserve an inactive membership for manual history without starting it.
    callCampaignId: existingCampaign?.id || savedId || ids[0] || null,
  };
}
