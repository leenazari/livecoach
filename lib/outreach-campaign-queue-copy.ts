export type OutreachQueueCampaignCount = {
  id: string;
  name: string;
  count: number;
};

type CampaignQueueRow = {
  campaign_id?: string | null;
  campaign?: { id?: string | null; name?: string | null } | null;
};

export function outreachQueueCampaignCounts(
  rows: CampaignQueueRow[]
): OutreachQueueCampaignCount[] {
  const counts = new Map<string, OutreachQueueCampaignCount>();
  for (const row of rows) {
    const id = String(row.campaign?.id || row.campaign_id || "unknown");
    const name = String(row.campaign?.name || "Campaign not recorded").trim();
    const current = counts.get(id);
    if (current) current.count += 1;
    else counts.set(id, { id, name, count: 1 });
  }
  return [...counts.values()].sort(
    (left, right) =>
      right.count - left.count || left.name.localeCompare(right.name)
  );
}

export function formatOutreachQueueCampaignCounts(
  counts: OutreachQueueCampaignCount[]
): string {
  if (!counts.length) return "no assigned contacts";
  return counts
    .map(
      (campaign) =>
        `${campaign.count} ${campaign.name} ${
          campaign.count === 1 ? "contact" : "contacts"
        }`
    )
    .join(", ");
}

export function explainOutreachCampaignSelection(input: {
  selectedCampaignName?: string | null;
  selectedCampaignId?: string | null;
  queueCampaigns: OutreachQueueCampaignCount[];
  queueLength: number;
  dailyLimit: number;
}): string {
  const selectedName = String(input.selectedCampaignName || "").trim();
  if (!selectedName)
    return "Select an active campaign before adding new contacts.";
  if (!input.queueLength)
    return `${selectedName} will supply the first contacts added to today’s queue.`;

  const breakdown = formatOutreachQueueCampaignCounts(input.queueCampaigns);
  const openSpaces = Math.max(0, input.dailyLimit - input.queueLength);
  const containsAnotherCampaign = input.queueCampaigns.some(
    (campaign) => campaign.id !== input.selectedCampaignId
  );
  if (!openSpaces) {
    return containsAnotherCampaign
      ? `Today’s queue is full with ${breakdown}. Those contacts stay in their original campaigns. ${selectedName} will only supply a new contact after a space opens.`
      : `Today’s queue is full with ${breakdown}. Changing this setting will not move those contacts. ${selectedName} will supply the next contact after a space opens.`;
  }
  return containsAnotherCampaign
    ? `Today’s queue currently has ${breakdown}. Those contacts stay in their original campaigns. ${selectedName} will fill only the ${openSpaces} open ${openSpaces === 1 ? "space" : "spaces"}.`
    : `Today’s queue currently has ${breakdown}. ${selectedName} will fill the remaining ${openSpaces} ${openSpaces === 1 ? "space" : "spaces"}.`;
}
