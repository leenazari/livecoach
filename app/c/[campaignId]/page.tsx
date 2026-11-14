import type { Metadata } from "next";

import CampaignLanding from "@/components/interviewer/CampaignLanding";
import { loadPublicCampaignCard } from "@/lib/interviewer/public-campaign-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Start a call",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PublicCampaignPage({
  params,
}: {
  params: { campaignId: string };
}) {
  try {
    const card = await loadPublicCampaignCard(params.campaignId);
    if (!card) {
      return (
        <main className="relative z-10 mx-auto flex min-h-screen max-w-xl items-center px-5">
          <section className="rounded-3xl border border-edge bg-panel p-8">
            <h1 className="font-display text-3xl text-bone">This link is not available</h1>
            <p className="mt-3 text-sm leading-6 text-muted">Ask the person who sent it for a new one.</p>
          </section>
        </main>
      );
    }
    return <CampaignLanding card={{ id: card.id, name: card.name, summary: card.summary, accepting: card.accepting, maxMinutes: card.maxMinutes }} />;
  } catch {
    return (
      <main className="relative z-10 mx-auto flex min-h-screen max-w-xl items-center px-5">
        <section className="rounded-3xl border border-edge bg-panel p-8">
          <h1 className="font-display text-3xl text-bone">This call is not available right now</h1>
          <p className="mt-3 text-sm leading-6 text-muted">Please try the link again later. Nothing has been started.</p>
        </section>
      </main>
    );
  }
}
