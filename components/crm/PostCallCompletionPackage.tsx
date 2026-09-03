"use client";

import { useEffect, useState } from "react";

import { crmFetch } from "@/lib/crm";
import { capitaliseSentenceStarts } from "@/lib/text";
import PostCallDealUpdate from "@/components/crm/PostCallDealUpdate";

type Commitment = {
  text: string;
  ownerType: "me" | "counterparty" | "joint";
  ownerName: string;
  dueAt: string | null;
};

type CompletionPackage = {
  relationship?: { brief?: string[]; playbook?: string[] };
  commercial?: { suggestion?: { title?: string; detail?: string } | null; pipelineExcluded?: boolean };
  commitments?: Commitment[];
  nextFocus?: { intent?: string | null; rationale?: string | null };
  followUp?: { subject?: string; body?: string } | null;
  generatedAt?: string;
};

const list = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()) as string[]
    : [];

export default function PostCallCompletionPackage({ callId }: { callId: string }) {
  const [data, setData] = useState<{ company: { id: string; name: string }; package: CompletionPackage } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    crmFetch<{ company: { id: string; name: string }; package: CompletionPackage }>(
      `/api/crm/calls/${callId}/completion-package`
    )
      .then(setData)
      .catch((err: any) => setError(err?.message || "Could not load the post-call package"));
  }, [callId]);

  if (error) {
    return <p className="mt-4 rounded-xl border border-rust/45 bg-rust/10 p-4 text-sm text-rust">{error}</p>;
  }
  if (!data) return null;
  const completion = data.package || {};
  const brief = list(completion.relationship?.brief);
  const playbook = list(completion.relationship?.playbook);
  const commitments = Array.isArray(completion.commitments) ? completion.commitments : [];
  const hasFollowUp = Boolean(completion.followUp?.subject || completion.followUp?.body);

  return (
    <section className="mt-4 rounded-xl border border-amber/45 bg-amber/[0.05] p-4">
      <div className="border-b border-edge pb-3">
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-amber">◆ Post-call completion package</p>
        <h2 className="mt-1 font-display text-lg text-bone">Everything to carry this relationship forward</h2>
        <p className="mt-1 text-xs leading-5 text-muted">One exact call and client. Drafts are never sent automatically.</p>
      </div>

      {(brief.length || playbook.length) ? <div className="mt-4 grid gap-3 md:grid-cols-2">
        {brief.length ? <div className="rounded-lg border border-edge bg-ink/35 p-3"><p className="font-mono text-[0.52rem] uppercase text-sky">Relationship update</p><ul className="mt-2 space-y-1.5 text-sm text-bone/80">{brief.map((item, index) => <li key={index} className="flex gap-2"><span className="text-sky">•</span><span>{capitaliseSentenceStarts(item)}</span></li>)}</ul></div> : null}
        {playbook.length ? <div className="rounded-lg border border-edge bg-ink/35 p-3"><p className="font-mono text-[0.52rem] uppercase text-moss">Best next plays</p><ol className="mt-2 space-y-1.5 text-sm text-bone/80">{playbook.map((item, index) => <li key={index} className="flex gap-2"><span className="text-moss">{index + 1}.</span><span>{capitaliseSentenceStarts(item)}</span></li>)}</ol></div> : null}
      </div> : null}

      {commitments.length ? <div className="mt-3 rounded-lg border border-edge bg-ink/35 p-3"><p className="font-mono text-[0.52rem] uppercase text-amber">Commitments and owners</p><div className="mt-2 space-y-2">{commitments.map((item, index) => <div key={index} className="flex flex-col gap-1 border-l-2 border-amber/45 pl-3 sm:flex-row sm:items-start sm:justify-between"><p className="text-sm text-bone/85">{capitaliseSentenceStarts(item.text)}</p><p className="shrink-0 font-mono text-[0.5rem] uppercase text-muted">{item.ownerName || (item.ownerType === "me" ? "You" : item.ownerType === "joint" ? "Joint" : "They")}{item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : " · no deadline recorded"}</p></div>)}</div></div> : null}

      {(completion.nextFocus?.intent || completion.nextFocus?.rationale) ? <div className="mt-3 rounded-lg border border-sky/35 bg-sky/[0.06] p-3"><p className="font-mono text-[0.52rem] uppercase text-sky">Next conversation focus</p>{completion.nextFocus?.intent ? <p className="mt-2 text-sm text-bone/90">{capitaliseSentenceStarts(completion.nextFocus.intent)}</p> : null}{completion.nextFocus?.rationale ? <p className="mt-1 text-xs leading-5 text-muted">Why now · {capitaliseSentenceStarts(completion.nextFocus.rationale)}</p> : null}</div> : null}

      {completion.commercial?.suggestion ? <div className="mt-3 rounded-lg border border-amber/35 bg-amber/[0.04] p-3"><p className="font-mono text-[0.52rem] uppercase text-amber">Commercial signal from this call</p><p className="mt-2 text-sm font-medium text-bone">{completion.commercial.suggestion.title || "Commercial opportunity"}</p>{completion.commercial.suggestion.detail ? <p className="mt-1 text-sm leading-5 text-bone/70">{capitaliseSentenceStarts(completion.commercial.suggestion.detail)}</p> : null}</div> : completion.commercial?.pipelineExcluded ? <p className="mt-3 rounded-lg border border-edge bg-ink/35 p-3 text-xs text-muted">This relationship is excluded from the sales pipeline. No deal was created.</p> : null}

      {hasFollowUp ? <details className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.05] p-3"><summary className="cursor-pointer list-none font-mono text-[0.52rem] uppercase text-moss [&::-webkit-details-marker]:hidden">Review unsent follow-up draft ▾</summary><p className="mt-3 text-sm font-medium text-bone">{completion.followUp?.subject || "No subject"}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-bone/75">{completion.followUp?.body}</p></details> : null}

      <div className="mt-3 border-t border-edge pt-3">
        <PostCallDealUpdate callId={callId} embedded />
      </div>
    </section>
  );
}
