import type { Metadata } from "next";

import CampaignStudio from "@/components/interviewer/CampaignStudio";

export const metadata: Metadata = { title: "New Interviewa campaign", robots: { index: false, follow: false } };

export default function NewCampaignPage() {
  return <CampaignStudio campaignId="" />;
}
