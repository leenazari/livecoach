import type { Metadata } from "next";

import OwnerConsole from "@/components/interviewer/OwnerConsole";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Interviewa",
  robots: { index: false, follow: false, nocache: true },
};

export default function InterviewerOwnerPage() {
  return <OwnerConsole />;
}
