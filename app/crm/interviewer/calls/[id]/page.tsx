import type { Metadata } from "next";

import CallBriefView from "@/components/interviewer/CallBrief";

export const metadata: Metadata = { title: "Pre-call brief", robots: { index: false, follow: false } };

export default function CallBriefPage({ params }: { params: { id: string } }) {
  return <CallBriefView sessionId={params.id} />;
}
