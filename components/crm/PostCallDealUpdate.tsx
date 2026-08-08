"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";

type Opportunity = Record<string, any>;
type DealData = {
  company: { id: string; name: string } | null;
  opportunities: Opportunity[];
  suggestion: string;
};

const probabilityByStage: Record<string, number> = {
  new: 10, discovery: 20, qualified: 40, proposal: 60,
  negotiation: 75, verbal: 90, won: 100, lost: 0,
};
const input = "min-h-11 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-bone outline-none focus:border-amber/60";

export default function PostCallDealUpdate({ callId }: { callId: string }) {
  const [data, setData] = useState<DealData | null>(null);
  const [opportunityId, setOpportunityId] = useState("");
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("discovery");
  const [probability, setProbability] = useState(20);
  const [value, setValue] = useState(0);
  const [nextAction, setNextAction] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [owner, setOwner] = useState("us");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const populate = (opportunity: Opportunity | undefined, suggestion: string, companyName = "") => {
    setOpportunityId(opportunity?.id || "");
    setTitle(opportunity?.title || `${companyName || "Client"} opportunity`);
    setStage(opportunity?.pipeline_stage || "discovery");
    setProbability(Number(opportunity?.probability) || 20);
    setValue(Number(opportunity?.value) || 0);
    setNextAction(opportunity?.next_action || suggestion || "");
    setDueAt(opportunity?.next_action_due_at?.slice(0, 10) || "");
    setOwner(opportunity?.next_action_owner || "us");
  };

  useEffect(() => {
    crmFetch<DealData>(`/api/crm/calls/${callId}/commercial-update`)
      .then((next) => {
        setData(next);
        populate(next.opportunities[0], next.suggestion, next.company?.name || "");
      })
      .catch(() => {});
  }, [callId]);

  if (!data) return null;

  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await crmFetch<{ opportunity: Opportunity }>(`/api/crm/calls/${callId}/commercial-update`, {
        method: "POST",
        body: JSON.stringify({
          opportunityId: opportunityId || null,
          title,
          pipelineStage: stage,
          probability,
          value,
          nextAction,
          nextActionDueAt: dueAt || null,
          nextActionOwner: owner,
        }),
      });
      setOpportunityId(result.opportunity.id);
      setNotice(stage === "won" ? "Deal marked won." : stage === "lost" ? "Deal closed as lost." : "Deal and next action saved.");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch (e: any) {
      setError(e.message || "That update did not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-amber/45 bg-amber/[0.06] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">◆ Close the commercial loop</p>
          <p className="mt-1 text-sm leading-5 text-bone/70">Confirm what changed, then create the one follow-up that progresses this relationship.</p>
        </div>
        <Link href="/crm/revenue" className="rounded-full border border-edge px-3 py-1.5 font-mono text-[0.54rem] uppercase text-muted hover:text-amber">Open revenue</Link>
      </div>

      {data.opportunities.length > 1 ? (
        <label className="mb-2 block"><span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Opportunity</span><select className={input} value={opportunityId} onChange={(event) => { const id = event.target.value; const opportunity = data.opportunities.find((row) => row.id === id); populate(opportunity, data.suggestion, data.company?.name || ""); }}><option value="">Create a new revenue opportunity</option>{data.opportunities.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
      ) : null}

      {!opportunityId ? <label className="mb-2 block"><span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Deal name</span><input className={input} value={title} onChange={(event) => setTitle(event.target.value)} /></label> : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <label><span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Stage after this call</span><select className={input} value={stage} onChange={(event) => { const next = event.target.value; setStage(next); setProbability(probabilityByStage[next]); }}><option value="new">New</option><option value="discovery">Discovery</option><option value="qualified">Qualified</option><option value="proposal">Proposal</option><option value="negotiation">Negotiation</option><option value="verbal">Verbal yes</option><option value="won">Won</option><option value="lost">Lost</option></select></label>
        <label><span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Probability %</span><input type="number" min="0" max="100" className={input} value={probability} onChange={(event) => setProbability(Number(event.target.value))} /></label>
        <label><span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Deal value £</span><input type="number" min="0" step="100" className={input} value={value || ""} onChange={(event) => setValue(Number(event.target.value))} placeholder="0" /></label>
      </div>

      {stage !== "won" && stage !== "lost" ? <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_9rem]">
        <label><span className="mb-1 block font-mono text-[0.52rem] uppercase text-amber">Primary next action</span><input className={input} value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="The one action that moves this forward" /></label>
        <label><span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Due</span><input type="date" className={input} value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <label><span className="mb-1 block font-mono text-[0.52rem] uppercase text-muted">Owner</span><select className={input} value={owner} onChange={(event) => setOwner(event.target.value)}><option value="us">Us</option><option value="buyer">Buyer</option><option value="joint">Joint</option></select></label>
      </div> : null}

      {error ? <p className="mt-2 text-sm text-rust">{error}</p> : null}
      {notice ? <p className="mt-2 text-sm text-sage">{notice}</p> : null}
      <button type="button" onClick={save} disabled={busy || (!opportunityId && !title.trim())} className="mt-3 min-h-11 w-full rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-amber disabled:opacity-40 sm:w-auto">{busy ? "Saving…" : stage === "won" ? "Save as won" : stage === "lost" ? "Close as lost" : "Save deal and next action"}</button>
    </section>
  );
}
