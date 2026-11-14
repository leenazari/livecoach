import type { Metadata } from "next";

import CampaignStudio from "@/components/interviewer/CampaignStudio";
import { previewProtectionQuery } from "@/lib/interviewer/share-link";

export const metadata: Metadata = { title: "Interviewa campaign", robots: { index: false, follow: false } };

export default function CampaignPage({ params }: { params: { id: string } }) {
  const shareQuery = previewProtectionQuery({
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_AUTOMATION_BYPASS_SECRET: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  return <CampaignStudio campaignId={params.id} shareQuery={shareQuery} />;
}
