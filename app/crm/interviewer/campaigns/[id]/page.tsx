import type { Metadata } from "next";

import CampaignStudio from "@/components/interviewer/CampaignStudio";

export const metadata: Metadata = { title: "Interviewa campaign", robots: { index: false, follow: false } };

export default function CampaignPage({ params }: { params: { id: string } }) {
  return <CampaignStudio campaignId={params.id} />;
}
