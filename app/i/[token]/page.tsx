import type { Metadata } from "next";

import InterviewerRoom from "@/components/interviewer/InterviewerRoom";
import { campaignOf, loadOpenInvite } from "@/lib/interviewer/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Private conversation",
  robots: { index: false, follow: false, nocache: true },
};

export default async function InterviewerInvitePage({
  params,
}: {
  params: { token: string };
}) {
  try {
    const invite = await loadOpenInvite(params.token);
    const campaign = invite ? campaignOf(invite) : null;
    if (!invite || !campaign) {
      return (
        <main className="relative z-10 mx-auto flex min-h-screen max-w-xl items-center px-5">
          <section className="rounded-3xl border border-edge bg-panel p-8">
            <h1 className="font-display text-3xl text-bone">This link is not available</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              It may have expired or been replaced. Ask the person who sent it for a new one.
            </p>
          </section>
        </main>
      );
    }
    return <InterviewerRoom token={params.token} campaignName={campaign.name} />;
  } catch {
    return (
      <main className="relative z-10 mx-auto flex min-h-screen max-w-xl items-center px-5">
        <section className="rounded-3xl border border-edge bg-panel p-8">
          <h1 className="font-display text-3xl text-bone">This conversation is not available right now</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Please try the link again later. Nothing has been booked.
          </p>
        </section>
      </main>
    );
  }
}
