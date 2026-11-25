"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";

type Brief = {
  attendees: string[];
  attendeeCount: number;
  lastCall: { id: string; headline: string; at: string } | null;
  email: { subject: string; context: string } | null;
  promises: { id: string; text: string; dueAt: string | null }[];
  gap: string;
  historyMatched: boolean;
};

function date(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Europe/London",
  });
}

export default function PreCallBrief({ callId }: { callId: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    crmFetch<Brief>(`/api/crm/upcoming/${encodeURIComponent(callId)}/brief`)
      .then(value => { if (current) setBrief(value); })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [callId]);

  return (
    <section aria-label="30-second brief" className="mb-5 rounded-xl border border-edge bg-panel px-4 py-3">
      <h2 className="mb-2 text-sm font-semibold text-bone">30-second brief</h2>
      {!brief ? (
        <p role="status" className="text-sm text-muted">{failed ? "Brief unavailable. You can still start the call." : "Loading your brief…"}</p>
      ) : (
        <dl className="grid gap-2 text-sm text-bone sm:grid-cols-[8rem_1fr]">
          <dt className="font-medium text-muted">Who’s on the call</dt>
          <dd>{brief.attendees.join(", ") || "No confirmed contacts shown"}{brief.attendeeCount > 3 ? ` +${brief.attendeeCount - 3} more` : ""}</dd>
          <dt className="font-medium text-muted">Last conversation</dt>
          <dd>
            {brief.lastCall && <Link className="underline decoration-edge hover:text-amber" href={`/crm/calls/${brief.lastCall.id}`}>{date(brief.lastCall.at)}: {brief.lastCall.headline}</Link>}
            {brief.email && <p className={brief.lastCall ? "mt-1" : undefined}>{brief.email.subject}: {brief.email.context}</p>}
            {!brief.lastCall && !brief.email && (brief.historyMatched ? "No linked calls or emails on file." : "No verified history for this meeting.")}
          </dd>
          <dt className="font-medium text-muted">Open follow-ups</dt>
          <dd>{brief.promises.length ? (
            <ul className="space-y-1">{brief.promises.map(task => <li key={task.id}>{task.text}{task.dueAt ? ` · Due ${date(task.dueAt)}` : " · No due date"}</li>)}</ul>
          ) : brief.historyMatched ? "None recorded." : "No verified follow-ups to show."}</dd>
          <dt className="font-medium text-muted">One thing to ask</dt>
          <dd>{brief.gap ? `Can we clarify this open point: ${brief.gap.replace(/[?.!…]+$/, "")}?` : "What would make this call useful, and what next step should we agree?"}</dd>
        </dl>
      )}
    </section>
  );
}
