"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import RevenueToday from "@/components/crm/RevenueToday";
import OutreachReadiness from "@/components/crm/OutreachReadiness";
import { crmFetch } from "@/lib/crm";

type Tab = "queue" | "prospects" | "campaign" | "intelligence" | "replies" | "safety";
type Priority = "high" | "medium" | "low";
type RecommendationAction = "contact_today" | "hold" | "skip";
type Recommendation = { action: RecommendationAction; label: string; score: number; confidence: "high" | "medium" | "low"; reasons: string[]; risks: string[] };
type Prospect = Record<string, any> & { id: string; email: string; company_name: string; priority: Priority; priority_score: number; recommendation: Recommendation };
type QueueRow = Record<string, any> & { id: string; prospect: Prospect; campaign: Record<string, any>; message: Record<string, any> | null; recommendation: Recommendation };
type SequenceStep = { step: number; delayDays: number; purpose: string; contentType?: "plain" | "insight" | "case_study" | "video" | "close_loop"; guidance?: string; assetUrl?: string | null };
type Campaign = Record<string, any> & { id: string; name: string; goal: string; audience: string; offer_angle: string; status: string; daily_limit: number; sequence: SequenceStep[] };
type HandoverPreview = {
  companyId: string | null;
  companyName: string | null;
  candidates: { id: string; name: string; domain: string | null }[];
  canCreateSafely: boolean;
  needsReview: boolean;
  reason: string;
};

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: "queue", label: "Today", icon: "☀" },
  { key: "prospects", label: "Prospects", icon: "◎" },
  { key: "campaign", label: "Campaign", icon: "↗" },
  { key: "intelligence", label: "Intelligence", icon: "◆" },
  { key: "replies", label: "Replies", icon: "✉" },
  { key: "safety", label: "Safety", icon: "⊘" },
];

const pill: Record<string, string> = {
  high: "border-rust/50 bg-rust/10 text-rust",
  medium: "border-amber/50 bg-amber/10 text-amber",
  low: "border-edge bg-ink/40 text-muted",
  approved: "border-moss/50 bg-moss/10 text-moss",
  sent: "border-moss/50 bg-moss/10 text-moss",
  drafted: "border-amber/50 bg-amber/10 text-amber",
};

const recommendationPill: Record<RecommendationAction, string> = {
  contact_today: "border-moss/50 bg-moss/10 text-moss",
  hold: "border-amber/50 bg-amber/10 text-amber",
  skip: "border-rust/50 bg-rust/10 text-rust",
};

const button = "min-h-11 rounded-lg border border-edge px-3 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-not-allowed disabled:opacity-40";
const primary = "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40";
const input = "w-full rounded-lg border border-edge bg-ink/50 px-3 py-2.5 text-sm text-bone placeholder:text-muted focus:border-amber/60 focus:outline-none";

function RecommendationCard({ recommendation, compact = false }: { recommendation: Recommendation; compact?: boolean }) {
  if (!recommendation) return null;
  return <div className="mt-3 rounded-lg border border-edge bg-ink/35 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`rounded-full border px-2.5 py-1 font-mono text-[0.55rem] uppercase tracking-wider ${recommendationPill[recommendation.action]}`}>{recommendation.label}</span>
      <span className="font-mono text-[0.56rem] uppercase text-muted"><strong className="text-bone">{recommendation.score}/100</strong> · {recommendation.confidence} confidence</span>
    </div>
    <ul className="mt-2 space-y-1 text-xs leading-5 text-bone/75">
      {recommendation.reasons.slice(0, compact ? 2 : 4).map((reason) => <li key={reason} className="flex gap-2"><span className="text-moss">+</span><span>{reason}</span></li>)}
      {recommendation.risks.slice(0, compact ? 1 : 3).map((risk) => <li key={risk} className="flex gap-2"><span className="text-amber">!</span><span>{risk}</span></li>)}
    </ul>
  </div>;
}

export default function OutreachPage() {
  const [tab, setTab] = useState<Tab>("queue");
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<any>({});
  const [replies, setReplies] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any[]>([]);
  const [learnings, setLearnings] = useState<any[]>([]);
  const [suppressions, setSuppressions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [recommendationFilter, setRecommendationFilter] = useState<"all" | RecommendationAction>("all");
  const [blockTarget, setBlockTarget] = useState("");
  const [draftEdits, setDraftEdits] = useState<Record<string, { subject: string; body_text: string }>>({});
  const [handoverReviews, setHandoverReviews] = useState<Record<string, HandoverPreview>>({});

  const loadCore = useCallback(async () => {
    try {
      const [qd, c, m] = await Promise.all([
        crmFetch<any>("/api/crm/outreach/queue"),
        crmFetch<any>("/api/crm/outreach/campaigns"),
        crmFetch<any>("/api/crm/outreach/metrics?summary=1"),
      ]);
      setQueue(qd.queue || []);
      setCampaigns(c.campaigns || []);
      setMetrics(m.metrics || {});
    } catch (e: any) { setError(e.message || "Could not load outreach"); }
    finally { setLoading(false); }
  }, []);

  const loadProspects = useCallback(async () => {
    const data = await crmFetch<any>("/api/crm/outreach");
    setProspects(data.prospects || []);
  }, []);

  const loadMetrics = useCallback(async () => {
    const data = await crmFetch<any>("/api/crm/outreach/metrics");
    setMetrics(data.metrics || {});
    setReplies(data.replies || []);
    setVariants(data.variants || []);
    setPerformance(data.performance || []);
    setLearnings(data.learnings || []);
  }, []);

  const loadSuppressions = useCallback(async () => {
    const data = await crmFetch<any>("/api/crm/outreach/suppressions");
    setSuppressions(data.suppressions || []);
  }, []);

  useEffect(() => { loadCore(); }, [loadCore]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (tabs.some((item) => item.key === requested)) setTab(requested as Tab);
  }, []);
  useEffect(() => {
    let alive = true;
    const requests: Promise<void>[] = [];
    if (tab === "prospects") requests.push(loadProspects());
    if (tab === "safety") requests.push(loadSuppressions());
    if (tab === "campaign" || tab === "intelligence" || tab === "replies")
      requests.push(loadMetrics());
    if (!requests.length) return;
    setTabLoading(true);
    Promise.all(requests)
      .catch((e: any) => alive && setError(e.message || "Could not load this section"))
      .finally(() => alive && setTabLoading(false));
    return () => { alive = false; };
  }, [tab, loadMetrics, loadProspects, loadSuppressions]);
  useEffect(() => {
    const next: Record<string, { subject: string; body_text: string }> = {};
    for (const row of queue) if (row.message) next[row.message.id] = { subject: row.message.subject || "", body_text: row.message.body_text || "" };
    for (const reply of replies) if (reply.bookingDraft) next[reply.bookingDraft.id] = { subject: reply.bookingDraft.subject || "", body_text: reply.bookingDraft.body_text || "" };
    setDraftEdits(next);
  }, [queue, replies]);

  const activeCampaign = campaigns.find((campaign) => campaign.status === "active") || campaigns[0];
  const selectTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "queue") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };
  const setMessage = (id: string, patch: Partial<{ subject: string; body_text: string }>) => setDraftEdits((all) => ({ ...all, [id]: { subject: all[id]?.subject || "", body_text: all[id]?.body_text || "", ...patch } }));

  const buildQueue = async () => {
    setBusy("queue"); setError(""); setNotice("");
    try { const data = await crmFetch<any>("/api/crm/outreach/queue", { method: "POST", body: JSON.stringify({ limit: activeCampaign?.daily_limit || 20 }) }); setQueue(data.queue || []); const held = data.selection?.held || 0; const skipped = data.selection?.skipped || 0; setNotice(`${data.added || 0} best-fit people added. ${held} held for stronger evidence${skipped ? ` and ${skipped} skipped` : ""}.`); await loadCore(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const prepare = async (prospectId: string) => {
    setBusy(`prepare:${prospectId}`); setError(""); setNotice("");
    try { await crmFetch(`/api/crm/outreach/${prospectId}/prepare`, { method: "POST", body: "{}" }); setNotice("Research and draft ready for review."); await loadCore(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const saveDraft = async (messageId: string, approve = false) => {
    setBusy(`${approve ? "approve" : "save"}:${messageId}`); setError("");
    try {
      const { message } = await crmFetch<{ message: Record<string, any> }>(`/api/crm/outreach/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ ...draftEdits[messageId], ...(approve ? { status: "approved" } : {}) }) });
      if (!message?.id) throw new Error("Draft was not confirmed");
      setQueue((all) => all.map((row) => row.message?.id === messageId ? { ...row, message: { ...row.message, ...message } } : row));
      setReplies((all) => all.map((reply) => reply.bookingDraft?.id === messageId ? { ...reply, bookingDraft: { ...reply.bookingDraft, ...message } } : reply));
      setDraftEdits((all) => ({ ...all, [messageId]: { subject: message.subject || "", body_text: message.body_text || "" } }));
      setNotice(approve ? "Approved. It is now eligible to send." : "Draft saved.");
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const send = async (messageId: string) => {
    if (!confirm("Send this approved email now from lee@interviewa.com?")) return;
    setBusy(`send:${messageId}`); setError("");
    try { const result = await crmFetch<any>(`/api/crm/outreach/messages/${messageId}/send`, { method: "POST", body: "{}" }); setNotice(`Sent from lee@interviewa.com. ${result.remainingToday} sends remain today.`); await loadCore(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const rehearse = async (messageId: string) => {
    if (!confirm("Send this exact draft only to lee@ai13.com as a rehearsal? The prospect will not be contacted and campaign results will not change.")) return;
    setBusy(`rehearse:${messageId}`); setError(""); setNotice("");
    try {
      // Save the words currently visible in the editor first. Otherwise an
      // unsaved edit could make the rehearsal differ from what Lee reviewed.
      const { message } = await crmFetch<{ message: Record<string, any> }>(`/api/crm/outreach/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify(draftEdits[messageId] || {}),
      });
      if (!message?.id || message.subject !== draftEdits[messageId]?.subject?.trim() || message.body_text !== draftEdits[messageId]?.body_text?.trim()) throw new Error("Save the visible draft before rehearsing it");
      setQueue((all) => all.map((row) => row.message?.id === messageId ? { ...row, message: { ...row.message, ...message } } : row));
      const result = await crmFetch<{ ok: boolean; sentTo: string; campaignChanged: boolean }>(`/api/crm/outreach/messages/${messageId}/rehearse`, { method: "POST", body: "{}" });
      if (!result.ok || result.sentTo !== "lee@ai13.com" || result.campaignChanged !== false) throw new Error("The safe rehearsal was not confirmed");
      setNotice("Rehearsal sent from lee@interviewa.com to lee@ai13.com. No prospect was contacted and campaign results did not change.");
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const updatePriority = async (id: string, value: Priority) => {
    const previous = prospects.find((prospect) => prospect.id === id);
    setProspects((all) => all.map((p) => p.id === id ? { ...p, priority: value } : p));
    try {
      const { prospect } = await crmFetch<{ prospect: Prospect }>(`/api/crm/outreach/${id}`, { method: "PATCH", body: JSON.stringify({ priority: value }) });
      if (prospect?.priority !== value) throw new Error("Priority was not confirmed");
      setProspects((all) => all.map((item) => item.id === id ? { ...item, ...prospect } : item));
    }
    catch (e: any) {
      if (previous) setProspects((all) => all.map((item) => item.id === id ? previous : item));
      setError(e.message);
    }
  };
  const saveCampaign = async (campaign: Campaign) => {
    setBusy(`campaign:${campaign.id}`); setError("");
    try {
      const { campaign: saved } = await crmFetch<{ campaign: Campaign }>(`/api/crm/outreach/campaigns/${campaign.id}`, { method: "PATCH", body: JSON.stringify(campaign) });
      if (!saved?.id) throw new Error("Campaign was not confirmed");
      setCampaigns((all) => all.map((item) => item.id === saved.id ? { ...item, ...saved } : saved.status === "active" && item.status === "active" ? { ...item, status: "paused" } : item));
      setNotice("Campaign settings saved.");
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const updateSequence = (campaignId: string, index: number, patch: Partial<SequenceStep>) => setCampaigns((all) => all.map((campaign) => campaign.id === campaignId ? { ...campaign, sequence: (campaign.sequence || []).map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) } : campaign));
  const addSequenceStep = (campaignId: string) => setCampaigns((all) => all.map((campaign) => campaign.id === campaignId ? { ...campaign, sequence: [...(campaign.sequence || []), { step: (campaign.sequence || []).length + 1, delayDays: 3, purpose: "Add a useful new reason to respond", contentType: "insight", guidance: "", assetUrl: null }] } : campaign));
  const removeSequenceStep = (campaignId: string, index: number) => setCampaigns((all) => all.map((campaign) => campaign.id === campaignId ? { ...campaign, sequence: (campaign.sequence || []).filter((_, stepIndex) => stepIndex !== index).map((step, stepIndex) => ({ ...step, step: stepIndex + 1, delayDays: stepIndex === 0 ? 0 : step.delayDays })) } : campaign));
  const checkReplies = async () => {
    setBusy("replies"); setError("");
    try { const result = await crmFetch<any>("/api/crm/outreach/replies", { method: "POST", body: "{}" }); setNotice(`Checked ${result.checked} recent contacts and found ${result.replies} new replies.`); await loadMetrics(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const prepareBookingReply = async (prospectId: string) => {
    setBusy(`booking:${prospectId}`); setError(""); setNotice("");
    try { await crmFetch(`/api/crm/outreach/replies/${prospectId}/draft`, { method: "POST", body: "{}" }); setNotice("Booking reply ready. Review and approve the exact wording before sending."); await loadMetrics(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const reviewHandover = async (prospectId: string) => {
    setBusy(`handover-check:${prospectId}`); setError(""); setNotice("");
    try {
      const { handover } = await crmFetch<{ handover: HandoverPreview }>(`/api/crm/outreach/${prospectId}/handover`);
      setHandoverReviews((all) => ({ ...all, [prospectId]: handover }));
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const completeHandover = async (prospectId: string, companyId?: string) => {
    setBusy(`handover-save:${prospectId}`); setError(""); setNotice("");
    try {
      const result = await crmFetch<{ companyId: string }>(`/api/crm/outreach/${prospectId}/handover`, {
        method: "POST",
        body: JSON.stringify(companyId ? { companyId } : { createNew: true }),
      });
      setNotice("CRM handover complete. The client profile and call context are now linked.");
      setHandoverReviews((all) => { const next = { ...all }; delete next[prospectId]; return next; });
      await loadMetrics();
      if (result.companyId) window.history.replaceState({}, "", "/crm/outreach?tab=replies");
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const addSuppression = async () => {
    if (!blockTarget.trim()) return;
    setBusy("block"); setError("");
    try { await crmFetch("/api/crm/outreach/suppressions", { method: "POST", body: JSON.stringify({ target: blockTarget }) }); setBlockTarget(""); setNotice("Added to the do-not-contact list."); await loadSuppressions(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };

  const recommendationCounts = useMemo(() => ({
    all: prospects.length,
    contact_today: prospects.filter((p) => p.recommendation?.action === "contact_today").length,
    hold: prospects.filter((p) => p.recommendation?.action === "hold").length,
    skip: prospects.filter((p) => p.recommendation?.action === "skip").length,
  }), [prospects]);
  const needle = useDeferredValue(q).trim().toLowerCase();
  const shown = prospects.filter((p) => (priority === "all" || p.priority === priority) && (recommendationFilter === "all" || p.recommendation?.action === recommendationFilter) && (!needle || `${p.first_name || ""} ${p.last_name || ""} ${p.company_name} ${p.job_title || ""} ${p.email}`.toLowerCase().includes(needle)));

  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-3 py-5 sm:px-5 sm:py-9">
      <NavMenu />
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-edge pb-4">
        <div><h1 className="font-display text-[1.55rem] tracking-tight text-bone"><span className="italic text-amber">Interviewa</span> outreach</h1><p className="mt-1 font-mono text-[0.57rem] uppercase tracking-wider text-muted">Approval mode · from lee@interviewa.com · maximum 20/day</p></div>
        <Link href="/crm" className="shrink-0 rounded-full border border-edge px-3 py-2 font-mono text-[0.6rem] uppercase text-muted">◂ CRM</Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[{ label: "Today's queue", value: queue.length, tab: "queue" as Tab }, { label: "Sent today", value: metrics.sentToday || 0, tab: "queue" as Tab }, { label: "Awaiting approval", value: queue.filter((r) => r.message?.status === "draft").length, tab: "queue" as Tab }, { label: "Positive replies", value: metrics.positiveReplies || 0, tab: "replies" as Tab }].map((item) => <button type="button" onClick={() => selectTab(item.tab)} key={item.label} className="rounded-xl border border-edge bg-panel p-3 text-left transition hover:border-amber/55"><strong className="block font-display text-2xl text-bone">{item.value}</strong><span className="font-mono text-[0.55rem] uppercase tracking-wider text-muted">{item.label} ↘</span></button>)}
      </section>

      <nav className="sticky top-0 z-20 mb-4 -mx-3 flex overflow-x-auto border-y border-edge bg-ink/95 px-3 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border">
        {tabs.map((item) => <button key={item.key} onClick={() => selectTab(item.key)} className={`min-h-12 shrink-0 border-b-2 px-3 font-mono text-[0.6rem] uppercase tracking-wider ${tab === item.key ? "border-amber text-amber" : "border-transparent text-muted"}`}><span className="mr-1.5">{item.icon}</span>{item.label}</button>)}
      </nav>

      {notice ? <p className="mb-3 rounded-lg border border-moss/40 bg-moss/10 px-3 py-2 text-sm text-moss">{notice}</p> : null}
      {error ? <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}
      {loading ? <p className="py-10 text-center font-mono text-xs text-muted">Loading outreach…</p> : null}
      {!loading && tabLoading ? <div className="h-44 animate-pulse rounded-xl border border-edge bg-panel/30" /> : null}

      {!loading && !tabLoading && tab === "queue" ? <section>
        <RevenueToday />
        <OutreachReadiness />
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-edge bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-display text-lg text-bone">Today’s controlled queue</h2><p className="mt-1 text-sm text-muted">Only the strongest safe fits use today’s limited slots. Scoring is free; research happens only when you press Prepare, and every draft waits for approval.</p></div><button onClick={buildQueue} disabled={!!busy || queue.length >= (activeCampaign?.daily_limit || 20)} className={primary}>{busy === "queue" ? "Ranking…" : queue.length ? `Top up to ${activeCampaign?.daily_limit || 20}` : "Rank + build today’s queue"}</button></div>
        <div className="space-y-3">{queue.map((row, index) => { const p = row.prospect; const m = row.message; const edit = m ? draftEdits[m.id] || { subject: m.subject, body_text: m.body_text } : null; return <article key={row.id} style={{ contentVisibility: "auto" }} className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-mono text-[0.55rem] uppercase text-muted">#{index + 1} · step {row.current_step}</p><h3 className="mt-1 font-display text-lg text-bone">{p.first_name} {p.last_name}</h3><p className="text-sm text-bone/80">{p.job_title} · {p.company_name}</p><div className="mt-2 flex flex-wrap gap-2"><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase ${pill[p.priority]}`}>{p.priority}</span><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase ${pill[m?.status] || "border-edge text-muted"}`}>{m?.status || "not prepared"}</span></div></div>{!m ? <button onClick={() => prepare(p.id)} disabled={!!busy} className={`${primary} w-full sm:w-auto`}>{busy === `prepare:${p.id}` ? "Researching…" : "Prepare research + draft"}</button> : null}</div>
          <RecommendationCard recommendation={row.recommendation || p.recommendation} compact />
          {row.research ? <details className="mt-4 rounded-lg border border-edge bg-ink/30 p-3"><summary className="cursor-pointer font-mono text-[0.6rem] uppercase tracking-wider text-amber">Why this message {m?.quality_score ? `· quality ${m.quality_score}/100` : ""}</summary><p className="mt-2 text-sm leading-6 text-bone/80">{m?.strategy?.reasoning || row.research.summary}</p><div className="mt-2 flex flex-wrap gap-1.5">{row.research.fitDecision ? <span className="rounded-full border border-moss/40 bg-moss/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-moss">{row.research.fitDecision}</span> : null}{row.research.commercialPath ? <span className="rounded-full border border-sky/40 bg-sky/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-sky">{row.research.commercialPath}</span> : null}{row.research.freshness ? <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.5rem] uppercase text-muted">{row.research.freshness}</span> : null}</div><p className="mt-2 text-xs text-muted"><strong className="text-bone">Chosen angle:</strong> {m?.strategy?.angle || row.research.bestAngle}</p>{m?.strategy?.evidenceUsed?.length ? <div className="mt-2"><p className="font-mono text-[0.53rem] uppercase text-muted">Evidence actually used</p><ul className="mt-1 space-y-1 text-xs text-bone/75">{m.strategy.evidenceUsed.map((fact: string) => <li key={fact}>• {fact}</li>)}</ul></div> : null}{(row.research_sources || []).length ? <div className="mt-2 flex flex-wrap gap-2">{row.research_sources.slice(0, 4).map((source: any) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-xs text-amber hover:underline">{source.title || "Source"} ↗</a>)}</div> : null}</details> : null}
          {m && edit ? <div className="mt-4 space-y-3 border-t border-edge pt-4"><div className="rounded-lg border border-edge bg-ink/40 px-3 py-2 font-mono text-[0.58rem] text-muted">From: <span className="text-bone">Lee Nazari &lt;lee@interviewa.com&gt;</span> · To: {p.email}</div><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Subject</span><input className={input} value={edit.subject} onChange={(e) => setMessage(m.id, { subject: e.target.value })} disabled={m.status === "sent"} /></label><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Email</span><textarea className={`${input} min-h-44 resize-y leading-6`} value={edit.body_text} onChange={(e) => setMessage(m.id, { body_text: e.target.value })} disabled={m.status === "sent"} /></label>{m.status !== "sent" ? <div className="rounded-lg border border-sky/35 bg-sky/[0.06] p-3"><p className="text-xs leading-5 text-bone/75">Test the real email appearance safely. The exact saved body goes only to <strong className="text-bone">lee@ai13.com</strong>; the prospect, sequence, daily allowance and results stay untouched.</p><button onClick={() => rehearse(m.id)} disabled={!!busy} className={`${button} mt-2 w-full border-sky/45 text-sky sm:w-auto`}>{busy === `rehearse:${m.id}` ? "Sending rehearsal…" : "Send rehearsal to me"}</button></div> : null}<div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><button onClick={() => saveDraft(m.id)} disabled={!!busy || m.status === "sent"} className={button}>Save changes</button>{m.status === "draft" || m.status === "failed" ? <button onClick={() => saveDraft(m.id, true)} disabled={!!busy} className={primary}>{busy === `approve:${m.id}` ? "Approving…" : "Approve exact draft"}</button> : null}{m.status === "approved" ? <button onClick={() => send(m.id)} disabled={!!busy} className={primary}>{busy === `send:${m.id}` ? "Sending…" : "Send now"}</button> : null}{m.status === "sent" ? <span className="self-center font-mono text-xs uppercase text-moss">✓ Sent safely</span> : null}</div></div> : null}
        </article>; })}{!queue.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">The morning queue can be selected automatically, or you can build it now. Nobody is researched or contacted until you act.</div> : null}</div>
      </section> : null}

      {!loading && !tabLoading && tab === "prospects" ? <section>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{(["all", "contact_today", "hold", "skip"] as const).map((key) => <button key={key} onClick={() => setRecommendationFilter(key)} className={`rounded-xl border p-3 text-left ${recommendationFilter === key ? "border-amber bg-amber/10" : "border-edge bg-panel"}`}><strong className="block font-display text-xl text-bone">{recommendationCounts[key]}</strong><span className="font-mono text-[0.54rem] uppercase text-muted">{key === "contact_today" ? "contact today" : key}</span></button>)}</div>
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_11rem]"><input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person, company, role or email…" /><select aria-label="Manual priority filter" value={priority} onChange={(e) => setPriority(e.target.value as "all" | Priority)} className={input}><option value="all">All manual priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select></div>
        <p className="mb-3 rounded-lg border border-edge bg-panel px-3 py-2 text-sm leading-6 text-muted">“Contact today” is limited to the campaign’s top 20 available fits. The score combines your priority, likely buying authority, campaign fit, data quality, saved research and proven conversion patterns. It never spends AI tokens.</p>
        <div className="space-y-2">{shown.map((p) => <article key={p.id} style={{ contentVisibility: "auto" }} className="rounded-xl border border-edge bg-panel p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h3 className="font-display text-lg text-bone">{p.first_name} {p.last_name}</h3><p className="text-sm text-bone/80">{p.job_title} · {p.company_name}</p><p className="mt-1 text-xs text-muted">{p.employee_range || "Unknown size"} employees · {p.industry || "Industry not saved"}</p><div className="mt-2 flex flex-wrap gap-3 text-xs"><span className="break-all text-amber">{p.email}</span>{p.person_linkedin_url ? <a href={p.person_linkedin_url} target="_blank" rel="noreferrer" className="text-bone">Person LinkedIn ↗</a> : null}{p.company_linkedin_url ? <a href={p.company_linkedin_url} target="_blank" rel="noreferrer" className="text-bone">Company LinkedIn ↗</a> : null}</div></div><label className="shrink-0"><span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Your priority</span><select aria-label={`Priority for ${p.first_name} ${p.last_name}`} value={p.priority} onChange={(e) => updatePriority(p.id, e.target.value as Priority)} className="min-h-11 w-full rounded-lg border border-edge bg-ink px-3 text-sm text-bone sm:w-auto"><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select></label></div><RecommendationCard recommendation={p.recommendation} /></article>)}</div>
      </section> : null}

      {!loading && !tabLoading && tab === "campaign" ? <section className="space-y-3">
        <div className="grid grid-cols-2 gap-2">{variants.map((row) => <div key={row.variant} className="rounded-xl border border-edge bg-panel p-3"><p className="font-mono text-[0.56rem] uppercase text-muted">Subject variant {row.variant}</p><strong className="mt-1 block font-display text-xl text-bone">{row.replyRate}% replies</strong><span className="text-xs text-muted">{row.replies} replies from {row.sent} sent</span></div>)}</div>
        {campaigns.map((campaign) => <article key={campaign.id} className="rounded-xl border border-edge bg-panel p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-lg text-bone">{campaign.name}</h2><span className={`mt-1 inline-block rounded-full border px-2 py-0.5 font-mono text-[0.55rem] uppercase ${campaign.status === "active" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{campaign.status}</span></div><button onClick={() => saveCampaign(campaign)} disabled={!!busy} className={primary}>{busy === `campaign:${campaign.id}` ? "Saving…" : "Save campaign"}</button></div>
          <div className="grid gap-3"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Goal</span><input className={input} value={campaign.goal} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, goal: e.target.value } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Audience</span><textarea className={`${input} min-h-20`} value={campaign.audience} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, audience: e.target.value } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Interviewa angle</span><textarea className={`${input} min-h-24`} value={campaign.offer_angle} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, offer_angle: e.target.value } : c))} /></label><div className="grid grid-cols-2 gap-3"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Daily maximum</span><input type="number" min="1" max="20" className={input} value={campaign.daily_limit} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, daily_limit: Math.min(20, Number(e.target.value)) } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Status</span><select className={`${input} min-h-11`} value={campaign.status} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, status: e.target.value } : c))}><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option></select></label></div></div>
          <div className="mt-4 rounded-xl border border-amber/35 bg-ink/30 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-[0.56rem] uppercase text-amber">Editable sequence</p><p className="mt-1 text-sm text-muted">Every step creates a fresh draft for approval. A reply stops all later steps.</p></div>{(campaign.sequence || []).length < 6 ? <button type="button" onClick={() => addSequenceStep(campaign.id)} className={button}>+ Add step</button> : null}</div>
            <ol className="mt-3 space-y-3">{(campaign.sequence || []).map((step, index) => <li key={`${campaign.id}:${index}`} className="rounded-lg border border-edge bg-panel/55 p-3">
              <div className="mb-2 flex items-center justify-between gap-2"><span className="font-mono text-[0.56rem] uppercase text-bone">Step {index + 1}{index === 0 ? " · first email" : ` · ${step.delayDays || 3} days later`}</span>{index > 0 ? <button type="button" onClick={() => removeSequenceStep(campaign.id, index)} className="min-h-9 px-2 font-mono text-[0.52rem] uppercase text-rust">Remove</button> : null}</div>
              <div className="grid gap-2 sm:grid-cols-[7rem_11rem_minmax(0,1fr)]">
                <label><span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Wait days</span><input type="number" min={index === 0 ? 0 : 1} max="30" disabled={index === 0} className={input} value={index === 0 ? 0 : step.delayDays || 3} onChange={(event) => updateSequence(campaign.id, index, { delayDays: Number(event.target.value) })} /></label>
                <label><span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Content</span><select className={input} value={step.contentType || "plain"} onChange={(event) => updateSequence(campaign.id, index, { contentType: event.target.value as SequenceStep["contentType"] })}><option value="plain">Plain follow-up</option><option value="insight">Useful insight</option><option value="case_study">Case study</option><option value="video">Video / demo</option><option value="close_loop">Close the loop</option></select></label>
                <label><span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Purpose</span><input className={input} value={step.purpose || ""} onChange={(event) => updateSequence(campaign.id, index, { purpose: event.target.value })} placeholder="Why this email deserves a response" /></label>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2"><label><span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Writing guidance</span><textarea className={`${input} min-h-20`} value={step.guidance || ""} onChange={(event) => updateSequence(campaign.id, index, { guidance: event.target.value })} placeholder="What new angle or proof should this step add?" /></label><label><span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">Approved asset link, optional</span><input type="url" className={input} value={step.assetUrl || ""} onChange={(event) => updateSequence(campaign.id, index, { assetUrl: event.target.value })} placeholder="https://… video, demo or case study" /><span className="mt-1 block text-xs text-muted">The draft can use this exact link, but still cannot send until you approve it.</span></label></div>
            </li>)}</ol>
          </div>
        </article>)}
      </section> : null}

      {!loading && !tabLoading && tab === "intelligence" && activeCampaign ? <section className="space-y-4">
        <div className="rounded-xl border border-amber/40 bg-amber/[0.06] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-display text-lg text-bone">Message intelligence</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Set the voice and guardrails once. For every person, Terra must show the evidence, chosen angle and quality score before you approve the exact words.</p></div><button onClick={() => saveCampaign(activeCampaign)} disabled={!!busy} className={primary}>{busy === `campaign:${activeCampaign.id}` ? "Saving…" : "Save intelligence"}</button></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Tone</span><select className={input} value={activeCampaign.voice?.tone || "warm, commercially curious and concise"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), tone: e.target.value } } : campaign))}><option value="warm, commercially curious and concise">Warm, commercially curious</option><option value="direct, credible and concise">Direct and credible</option><option value="peer-to-peer founder, thoughtful and natural">Founder to founder</option><option value="consultative, challenging and evidence-led">Consultative challenger</option></select></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Writing style</span><input className={input} value={activeCampaign.voice?.style || "founder-to-founder, plain English and respectful"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), style: e.target.value } } : campaign))} /></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Coaching rules, one per line</span><textarea className={`${input} min-h-36 leading-6`} value={(activeCampaign.voice?.rules || []).join("\n")} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), rules: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } } : campaign))} /></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Never say, one per line</span><textarea className={`${input} min-h-36 leading-6`} value={(activeCampaign.banned_phrases || []).join("\n")} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, banned_phrases: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } : campaign))} /></label>
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4">
          <h2 className="font-display text-lg text-bone">AI13 calendar handoff</h2><p className="mt-1 text-sm leading-6 text-muted">The safest default is to earn interest first. A positive reply gets a draft containing your booking link, which still needs your approval.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_13rem]"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Booking link</span><input className={input} placeholder="https://calendar.google.com/calendar/appointments/…" value={activeCampaign.booking_url || ""} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, booking_url: e.target.value } : campaign))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">When to include</span><select className={input} value={activeCampaign.booking_cta_mode || "interested_reply"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, booking_cta_mode: e.target.value } : campaign))}><option value="interested_reply">Only after interest</option><option value="final_step">Final sequence email</option><option value="always">Every email</option><option value="never">Never</option></select></label></div>
          <p className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.07] px-3 py-2 text-sm text-moss">When a prospect books, Calendar Sync links the meeting and seeds the call intent with the research, sent email and reply. Deal value and probability stay blank until a real conversation supports them.</p>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4"><h2 className="font-display text-lg text-bone">Conversion learning</h2><p className="mt-1 text-sm leading-6 text-muted">We measure positive replies and booked meetings, not vanity opens. A pattern is not fed back into new drafts until it has at least 10 sends and meaningful conversion evidence.</p>
          {learnings.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{learnings.map((learning) => <div key={learning.id} className="rounded-lg border border-edge bg-ink/30 p-3"><div className="flex items-center justify-between gap-2"><span className="font-mono text-[0.55rem] uppercase text-amber">{learning.dimension} · {learning.label}</span><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.49rem] uppercase ${learning.status === "promoted" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{learning.status}</span></div><p className="mt-2 text-sm leading-6 text-bone/80">{learning.insight}</p><p className="mt-1 text-xs text-muted">{learning.confidence} confidence</p></div>)}</div> : <div className="mt-3 rounded-lg border border-dashed border-edge p-5 text-center text-sm text-muted">No result is being called a “winner” yet. The system will wait for real sends, positive replies and meetings.</div>}
          {performance.length ? <div className="mt-4"><p className="mb-2 font-mono text-[0.54rem] uppercase text-muted">Early observations</p><div className="flex gap-2 overflow-x-auto pb-1">{performance.slice(0, 8).map((row) => <div key={`${row.dimension}:${row.label}`} className="min-w-52 rounded-lg border border-edge bg-ink/30 p-3"><span className="font-mono text-[0.52rem] uppercase text-muted">{row.dimension}</span><strong className="mt-1 block truncate text-sm text-bone">{row.label}</strong><p className="mt-1 text-xs text-muted">{row.positiveRate}% positive · {row.meetings} meetings · {row.sent} sent</p></div>)}</div></div> : null}
        </div>
      </section> : null}

      {!loading && !tabLoading && tab === "replies" ? <section>
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-edge bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-display text-lg text-bone">Reply inbox</h2><p className="mt-1 text-sm text-muted">Every reply stops the sequence. Interested people are linked safely to the CRM, while deal value waits until a real conversation.</p></div><button onClick={checkReplies} disabled={!!busy} className={primary}>{busy === "replies" ? "Checking Gmail…" : "Check replies now"}</button></div>
        <div className="space-y-2">{replies.map((reply) => { const draft = reply.bookingDraft; const edit = draft ? draftEdits[draft.id] || { subject: draft.subject, body_text: draft.body_text } : null; const handover = handoverReviews[reply.id]; return <article key={reply.id} className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-display text-lg text-bone">{reply.first_name} {reply.last_name}</h3><p className="text-sm text-bone/80">{reply.company_name}</p></div><span className={`rounded-full border px-2 py-1 font-mono text-[0.55rem] uppercase ${reply.reply_category === "interested" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{reply.reply_category}</span></div>
          <p className="mt-3 text-sm leading-6 text-bone/80">{reply.reply_summary}</p>
          {reply.reply_category === "interested" ? <div className="mt-3 rounded-lg border border-edge bg-ink/35 p-3">
            {reply.crmCompany ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.55rem] uppercase text-moss">✓ CRM handover complete</p><p className="mt-1 text-sm text-bone/80">Linked to {reply.crmCompany.name}{reply.bookedMeeting ? " · meeting booked" : " · sequence stopped"}</p></div><Link href={`/crm/${reply.crmCompany.id}`} className={`${button} inline-flex items-center justify-center`}>Open client</Link></div> : <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.55rem] uppercase text-amber">CRM match needs approval</p><p className="mt-1 text-sm text-muted">No client record will be guessed or duplicated.</p></div><button onClick={() => reviewHandover(reply.id)} disabled={!!busy} className={button}>{busy === `handover-check:${reply.id}` ? "Checking…" : handover ? "Refresh choices" : "Review match"}</button></div>
              {handover ? <div className="mt-3 border-t border-edge pt-3"><p className="text-sm text-bone/80">{handover.reason}</p>{handover.candidates.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{handover.candidates.map((candidate) => <button key={candidate.id} onClick={() => completeHandover(reply.id, candidate.id)} disabled={!!busy} className={`${button} text-left normal-case tracking-normal`}><strong className="block text-bone">Link to {candidate.name}</strong><span className="text-xs text-muted">{candidate.domain || "No domain saved"}</span></button>)}</div> : null}<button onClick={() => completeHandover(reply.id)} disabled={!!busy} className={`${primary} mt-2 w-full sm:w-auto`}>{busy === `handover-save:${reply.id}` ? "Saving…" : `Create new ${reply.company_name} profile`}</button></div> : null}
            </div>}
          </div> : null}
          {reply.reply_category === "interested" && !draft ? <button onClick={() => prepareBookingReply(reply.id)} disabled={!!busy} className={`${primary} mt-3 w-full sm:w-auto`}>{busy === `booking:${reply.id}` ? "Drafting…" : "Prepare booking reply"}</button> : null}
          {draft && edit ? <div className="mt-4 space-y-3 border-t border-edge pt-4"><div className="rounded-lg border border-moss/35 bg-moss/[0.06] px-3 py-2 text-sm text-moss">This is still a draft. Review the exact words and calendar link before approval.</div><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Reply subject</span><input className={input} value={edit.subject} onChange={(e) => setMessage(draft.id, { subject: e.target.value })} disabled={draft.status === "sent"} /></label><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Reply</span><textarea className={`${input} min-h-40 resize-y leading-6`} value={edit.body_text} onChange={(e) => setMessage(draft.id, { body_text: e.target.value })} disabled={draft.status === "sent"} /></label><div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><button onClick={() => saveDraft(draft.id)} disabled={!!busy || draft.status === "sent"} className={button}>Save changes</button>{draft.status === "draft" || draft.status === "failed" ? <button onClick={() => saveDraft(draft.id, true)} disabled={!!busy} className={primary}>Approve exact reply</button> : null}{draft.status === "approved" ? <button onClick={() => send(draft.id)} disabled={!!busy} className={primary}>Send booking reply</button> : null}{draft.status === "sent" ? <span className="self-center font-mono text-xs uppercase text-moss">✓ Booking link sent</span> : null}</div></div> : null}
          <a href={`mailto:${reply.email}`} className="mt-3 inline-block font-mono text-xs text-amber">Open in Gmail ↗</a>
        </article>; })}{!replies.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">No replies detected yet.</div> : null}</div>
      </section> : null}

      {!loading && !tabLoading && tab === "safety" ? <section className="space-y-4"><div className="rounded-xl border border-moss/40 bg-moss/10 p-4"><h2 className="font-display text-lg text-bone">Safety rules are active</h2><ul className="mt-3 space-y-2 text-sm text-bone/80"><li>• Nothing sends without approval of that exact draft.</li><li>• Every email is forced through Lee Nazari &lt;lee@interviewa.com&gt;.</li><li>• Maximum 20 sends per London calendar day.</li><li>• Existing CRM companies, replies and blocked addresses stop outreach.</li><li>• Only one person per company enters a daily queue.</li><li>• No tracking pixels or hidden open tracking.</li></ul></div><div className="rounded-xl border border-edge bg-panel p-4"><h2 className="font-display text-lg text-bone">Do-not-contact list</h2><p className="mt-1 text-sm text-muted">Block a person’s email or an entire company domain.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className={input} value={blockTarget} onChange={(e) => setBlockTarget(e.target.value)} placeholder="person@company.com or company.com" /><button onClick={addSuppression} disabled={!!busy || !blockTarget.trim()} className={primary}>Block</button></div><div className="mt-4 space-y-2">{suppressions.map((item) => <div key={item.target} className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink/30 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm text-bone">{item.target}</p><p className="text-xs text-muted">{item.reason}</p></div><span className="font-mono text-[0.54rem] uppercase text-muted">{item.kind}</span></div>)}</div></div></section> : null}
    </main>
  );
}
