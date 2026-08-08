"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";

type Tab = "queue" | "prospects" | "campaign" | "intelligence" | "replies" | "safety";
type Priority = "high" | "medium" | "low";
type Prospect = Record<string, any> & { id: string; email: string; company_name: string; priority: Priority; priority_score: number };
type QueueRow = Record<string, any> & { id: string; prospect: Prospect; campaign: Record<string, any>; message: Record<string, any> | null };
type Campaign = Record<string, any> & { id: string; name: string; goal: string; audience: string; offer_angle: string; status: string; daily_limit: number };

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

const button = "min-h-11 rounded-lg border border-edge px-3 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-not-allowed disabled:opacity-40";
const primary = "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40";
const input = "w-full rounded-lg border border-edge bg-ink/50 px-3 py-2.5 text-sm text-bone placeholder:text-muted focus:border-amber/60 focus:outline-none";

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
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [blockTarget, setBlockTarget] = useState("");
  const [draftEdits, setDraftEdits] = useState<Record<string, { subject: string; body_text: string }>>({});

  const load = useCallback(async () => {
    try {
      const [p, qd, c, m, s] = await Promise.all([
        crmFetch<any>("/api/crm/outreach"), crmFetch<any>("/api/crm/outreach/queue"),
        crmFetch<any>("/api/crm/outreach/campaigns"), crmFetch<any>("/api/crm/outreach/metrics"),
        crmFetch<any>("/api/crm/outreach/suppressions"),
      ]);
      setProspects(p.prospects || []); setQueue(qd.queue || []); setCampaigns(c.campaigns || []);
      setMetrics(m.metrics || {}); setReplies(m.replies || []); setVariants(m.variants || []); setPerformance(m.performance || []); setLearnings(m.learnings || []); setSuppressions(s.suppressions || []);
    } catch (e: any) { setError(e.message || "Could not load outreach"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const next: Record<string, { subject: string; body_text: string }> = {};
    for (const row of queue) if (row.message) next[row.message.id] = { subject: row.message.subject || "", body_text: row.message.body_text || "" };
    for (const reply of replies) if (reply.bookingDraft) next[reply.bookingDraft.id] = { subject: reply.bookingDraft.subject || "", body_text: reply.bookingDraft.body_text || "" };
    setDraftEdits(next);
  }, [queue, replies]);

  const activeCampaign = campaigns.find((campaign) => campaign.status === "active") || campaigns[0];
  const setMessage = (id: string, patch: Partial<{ subject: string; body_text: string }>) => setDraftEdits((all) => ({ ...all, [id]: { subject: all[id]?.subject || "", body_text: all[id]?.body_text || "", ...patch } }));

  const buildQueue = async () => {
    setBusy("queue"); setError(""); setNotice("");
    try { const data = await crmFetch<any>("/api/crm/outreach/queue", { method: "POST", body: JSON.stringify({ limit: activeCampaign?.daily_limit || 20 }) }); setQueue(data.queue || []); setNotice(`${data.added || 0} people added to today's queue.`); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const prepare = async (prospectId: string) => {
    setBusy(`prepare:${prospectId}`); setError(""); setNotice("");
    try { await crmFetch(`/api/crm/outreach/${prospectId}/prepare`, { method: "POST", body: "{}" }); setNotice("Research and draft ready for review."); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const saveDraft = async (messageId: string, approve = false) => {
    setBusy(`${approve ? "approve" : "save"}:${messageId}`); setError("");
    try { await crmFetch(`/api/crm/outreach/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ ...draftEdits[messageId], ...(approve ? { status: "approved" } : {}) }) }); setNotice(approve ? "Approved. It is now eligible to send." : "Draft saved."); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const send = async (messageId: string) => {
    if (!confirm("Send this approved email now from lee@interviewa.com?")) return;
    setBusy(`send:${messageId}`); setError("");
    try { const result = await crmFetch<any>(`/api/crm/outreach/messages/${messageId}/send`, { method: "POST", body: "{}" }); setNotice(`Sent from lee@interviewa.com. ${result.remainingToday} sends remain today.`); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const updatePriority = async (id: string, value: Priority) => {
    setProspects((all) => all.map((p) => p.id === id ? { ...p, priority: value } : p));
    try { await crmFetch(`/api/crm/outreach/${id}`, { method: "PATCH", body: JSON.stringify({ priority: value }) }); }
    catch (e: any) { setError(e.message); await load(); }
  };
  const saveCampaign = async (campaign: Campaign) => {
    setBusy(`campaign:${campaign.id}`); setError("");
    try { await crmFetch(`/api/crm/outreach/campaigns/${campaign.id}`, { method: "PATCH", body: JSON.stringify(campaign) }); setNotice("Campaign settings saved."); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const checkReplies = async () => {
    setBusy("replies"); setError("");
    try { const result = await crmFetch<any>("/api/crm/outreach/replies", { method: "POST", body: "{}" }); setNotice(`Checked ${result.checked} recent contacts and found ${result.replies} new replies.`); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const prepareBookingReply = async (prospectId: string) => {
    setBusy(`booking:${prospectId}`); setError(""); setNotice("");
    try { await crmFetch(`/api/crm/outreach/replies/${prospectId}/draft`, { method: "POST", body: "{}" }); setNotice("Booking reply ready. Review and approve the exact wording before sending."); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const addSuppression = async () => {
    if (!blockTarget.trim()) return;
    setBusy("block"); setError("");
    try { await crmFetch("/api/crm/outreach/suppressions", { method: "POST", body: JSON.stringify({ target: blockTarget }) }); setBlockTarget(""); setNotice("Added to the do-not-contact list."); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };

  const counts = useMemo(() => ({ all: prospects.length, high: prospects.filter((p) => p.priority === "high").length, medium: prospects.filter((p) => p.priority === "medium").length, low: prospects.filter((p) => p.priority === "low").length }), [prospects]);
  const needle = useDeferredValue(q).trim().toLowerCase();
  const shown = prospects.filter((p) => (priority === "all" || p.priority === priority) && (!needle || `${p.first_name || ""} ${p.last_name || ""} ${p.company_name} ${p.job_title || ""} ${p.email}`.toLowerCase().includes(needle)));

  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-3 py-5 sm:px-5 sm:py-9">
      <NavMenu />
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-edge pb-4">
        <div><h1 className="font-display text-[1.55rem] tracking-tight text-bone"><span className="italic text-amber">Interviewa</span> outreach</h1><p className="mt-1 font-mono text-[0.57rem] uppercase tracking-wider text-muted">Approval mode · from lee@interviewa.com · maximum 20/day</p></div>
        <Link href="/crm" className="shrink-0 rounded-full border border-edge px-3 py-2 font-mono text-[0.6rem] uppercase text-muted">◂ CRM</Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[{ label: "Today's queue", value: queue.length }, { label: "Sent today", value: metrics.sentToday || 0 }, { label: "Awaiting approval", value: queue.filter((r) => r.message?.status === "draft").length }, { label: "Positive replies", value: metrics.positiveReplies || 0 }].map((item) => <div key={item.label} className="rounded-xl border border-edge bg-panel p-3"><strong className="block font-display text-2xl text-bone">{item.value}</strong><span className="font-mono text-[0.55rem] uppercase tracking-wider text-muted">{item.label}</span></div>)}
      </section>

      <nav className="sticky top-0 z-20 mb-4 -mx-3 flex overflow-x-auto border-y border-edge bg-ink/95 px-3 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border">
        {tabs.map((item) => <button key={item.key} onClick={() => setTab(item.key)} className={`min-h-12 shrink-0 border-b-2 px-3 font-mono text-[0.6rem] uppercase tracking-wider ${tab === item.key ? "border-amber text-amber" : "border-transparent text-muted"}`}><span className="mr-1.5">{item.icon}</span>{item.label}</button>)}
      </nav>

      {notice ? <p className="mb-3 rounded-lg border border-moss/40 bg-moss/10 px-3 py-2 text-sm text-moss">{notice}</p> : null}
      {error ? <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}
      {loading ? <p className="py-10 text-center font-mono text-xs text-muted">Loading outreach…</p> : null}

      {!loading && tab === "queue" ? <section>
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-edge bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-display text-lg text-bone">Today’s controlled queue</h2><p className="mt-1 text-sm text-muted">Research happens only when you press Prepare. Every draft waits for your approval.</p></div><button onClick={buildQueue} disabled={!!busy || queue.length >= (activeCampaign?.daily_limit || 20)} className={primary}>{busy === "queue" ? "Building…" : queue.length ? `Top up to ${activeCampaign?.daily_limit || 20}` : "Build today’s queue"}</button></div>
        <div className="space-y-3">{queue.map((row, index) => { const p = row.prospect; const m = row.message; const edit = m ? draftEdits[m.id] || { subject: m.subject, body_text: m.body_text } : null; return <article key={row.id} style={{ contentVisibility: "auto" }} className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-mono text-[0.55rem] uppercase text-muted">#{index + 1} · step {row.current_step}</p><h3 className="mt-1 font-display text-lg text-bone">{p.first_name} {p.last_name}</h3><p className="text-sm text-bone/80">{p.job_title} · {p.company_name}</p><div className="mt-2 flex flex-wrap gap-2"><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase ${pill[p.priority]}`}>{p.priority}</span><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase ${pill[m?.status] || "border-edge text-muted"}`}>{m?.status || "not prepared"}</span></div></div>{!m ? <button onClick={() => prepare(p.id)} disabled={!!busy} className={primary}>{busy === `prepare:${p.id}` ? "Researching…" : "Prepare research + draft"}</button> : null}</div>
          {row.research ? <details className="mt-4 rounded-lg border border-edge bg-ink/30 p-3"><summary className="cursor-pointer font-mono text-[0.6rem] uppercase tracking-wider text-amber">Why this message {m?.quality_score ? `· quality ${m.quality_score}/100` : ""}</summary><p className="mt-2 text-sm leading-6 text-bone/80">{m?.strategy?.reasoning || row.research.summary}</p><p className="mt-2 text-xs text-muted"><strong className="text-bone">Chosen angle:</strong> {m?.strategy?.angle || row.research.bestAngle}</p>{m?.strategy?.evidenceUsed?.length ? <div className="mt-2"><p className="font-mono text-[0.53rem] uppercase text-muted">Evidence actually used</p><ul className="mt-1 space-y-1 text-xs text-bone/75">{m.strategy.evidenceUsed.map((fact: string) => <li key={fact}>• {fact}</li>)}</ul></div> : null}{(row.research_sources || []).length ? <div className="mt-2 flex flex-wrap gap-2">{row.research_sources.slice(0, 4).map((source: any) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-xs text-amber hover:underline">{source.title || "Source"} ↗</a>)}</div> : null}</details> : null}
          {m && edit ? <div className="mt-4 space-y-3 border-t border-edge pt-4"><div className="rounded-lg border border-edge bg-ink/40 px-3 py-2 font-mono text-[0.58rem] text-muted">From: <span className="text-bone">Lee Nazari &lt;lee@interviewa.com&gt;</span> · To: {p.email}</div><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Subject</span><input className={input} value={edit.subject} onChange={(e) => setMessage(m.id, { subject: e.target.value })} disabled={m.status === "sent"} /></label><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Email</span><textarea className={`${input} min-h-44 resize-y leading-6`} value={edit.body_text} onChange={(e) => setMessage(m.id, { body_text: e.target.value })} disabled={m.status === "sent"} /></label><div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><button onClick={() => saveDraft(m.id)} disabled={!!busy || m.status === "sent"} className={button}>Save changes</button>{m.status === "draft" || m.status === "failed" ? <button onClick={() => saveDraft(m.id, true)} disabled={!!busy} className={primary}>{busy === `approve:${m.id}` ? "Approving…" : "Approve exact draft"}</button> : null}{m.status === "approved" ? <button onClick={() => send(m.id)} disabled={!!busy} className={primary}>{busy === `send:${m.id}` ? "Sending…" : "Send now"}</button> : null}{m.status === "sent" ? <span className="self-center font-mono text-xs uppercase text-moss">✓ Sent safely</span> : null}</div></div> : null}
        </article>; })}{!queue.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">The morning queue can be selected automatically, or you can build it now. Nobody is researched or contacted until you act.</div> : null}</div>
      </section> : null}

      {!loading && tab === "prospects" ? <section><div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{(["all", "high", "medium", "low"] as const).map((key) => <button key={key} onClick={() => setPriority(key)} className={`rounded-xl border p-3 text-left ${priority === key ? "border-amber bg-amber/10" : "border-edge bg-panel"}`}><strong className="block font-display text-xl text-bone">{counts[key]}</strong><span className="font-mono text-[0.54rem] uppercase text-muted">{key}</span></button>)}</div><input className={`${input} mb-3`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person, company, role or email…" /><div className="space-y-2">{shown.map((p) => <article key={p.id} style={{ contentVisibility: "auto" }} className="rounded-xl border border-edge bg-panel p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-display text-lg text-bone">{p.first_name} {p.last_name}</h3><p className="text-sm text-bone/80">{p.job_title} · {p.company_name}</p><p className="mt-1 text-xs text-muted">{p.employee_range} employees · {p.industry}</p><div className="mt-2 flex flex-wrap gap-3 text-xs"><span className="text-amber">{p.email}</span>{p.person_linkedin_url ? <a href={p.person_linkedin_url} target="_blank" rel="noreferrer" className="text-bone">Person LinkedIn ↗</a> : null}{p.company_linkedin_url ? <a href={p.company_linkedin_url} target="_blank" rel="noreferrer" className="text-bone">Company LinkedIn ↗</a> : null}</div></div><select aria-label={`Priority for ${p.first_name} ${p.last_name}`} value={p.priority} onChange={(e) => updatePriority(p.id, e.target.value as Priority)} className="min-h-11 rounded-lg border border-edge bg-ink px-3 text-sm text-bone"><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select></div></article>)}</div></section> : null}

      {!loading && tab === "campaign" ? <section className="space-y-3"><div className="grid grid-cols-2 gap-2">{variants.map((row) => <div key={row.variant} className="rounded-xl border border-edge bg-panel p-3"><p className="font-mono text-[0.56rem] uppercase text-muted">Subject variant {row.variant}</p><strong className="mt-1 block font-display text-xl text-bone">{row.replyRate}% replies</strong><span className="text-xs text-muted">{row.replies} replies from {row.sent} sent</span></div>)}</div>{campaigns.map((campaign) => <article key={campaign.id} className="rounded-xl border border-edge bg-panel p-4"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-display text-lg text-bone">{campaign.name}</h2><span className={`mt-1 inline-block rounded-full border px-2 py-0.5 font-mono text-[0.55rem] uppercase ${campaign.status === "active" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{campaign.status}</span></div><button onClick={() => saveCampaign(campaign)} disabled={!!busy} className={primary}>Save campaign</button></div><div className="grid gap-3"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Goal</span><input className={input} value={campaign.goal} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, goal: e.target.value } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Audience</span><textarea className={`${input} min-h-20`} value={campaign.audience} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, audience: e.target.value } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Interviewa angle</span><textarea className={`${input} min-h-24`} value={campaign.offer_angle} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, offer_angle: e.target.value } : c))} /></label><div className="grid grid-cols-2 gap-3"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Daily maximum</span><input type="number" min="1" max="20" className={input} value={campaign.daily_limit} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, daily_limit: Math.min(20, Number(e.target.value)) } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Status</span><select className={`${input} min-h-11`} value={campaign.status} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, status: e.target.value } : c))}><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option></select></label></div></div><div className="mt-4 rounded-lg border border-edge bg-ink/30 p-3"><p className="font-mono text-[0.56rem] uppercase text-amber">Sequence</p><ol className="mt-2 space-y-2 text-sm text-bone/80">{(campaign.sequence || []).map((step: any) => <li key={step.step}><strong className="text-bone">{step.step}.</strong> {step.purpose}{step.delayDays ? ` · ${step.delayDays} days later` : " · first email"}</li>)}</ol></div></article>)}</section> : null}

      {!loading && tab === "intelligence" && activeCampaign ? <section className="space-y-4">
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
          <p className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.07] px-3 py-2 text-sm text-moss">When a prospect books, Calendar Sync links the meeting, creates the CRM opportunity, and seeds the call intent with the research, sent email and reply.</p>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4"><h2 className="font-display text-lg text-bone">Conversion learning</h2><p className="mt-1 text-sm leading-6 text-muted">We measure positive replies and booked meetings, not vanity opens. A pattern is not fed back into new drafts until it has at least 10 sends and meaningful conversion evidence.</p>
          {learnings.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{learnings.map((learning) => <div key={learning.id} className="rounded-lg border border-edge bg-ink/30 p-3"><div className="flex items-center justify-between gap-2"><span className="font-mono text-[0.55rem] uppercase text-amber">{learning.dimension} · {learning.label}</span><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.49rem] uppercase ${learning.status === "promoted" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{learning.status}</span></div><p className="mt-2 text-sm leading-6 text-bone/80">{learning.insight}</p><p className="mt-1 text-xs text-muted">{learning.confidence} confidence</p></div>)}</div> : <div className="mt-3 rounded-lg border border-dashed border-edge p-5 text-center text-sm text-muted">No result is being called a “winner” yet. The system will wait for real sends, positive replies and meetings.</div>}
          {performance.length ? <div className="mt-4"><p className="mb-2 font-mono text-[0.54rem] uppercase text-muted">Early observations</p><div className="flex gap-2 overflow-x-auto pb-1">{performance.slice(0, 8).map((row) => <div key={`${row.dimension}:${row.label}`} className="min-w-52 rounded-lg border border-edge bg-ink/30 p-3"><span className="font-mono text-[0.52rem] uppercase text-muted">{row.dimension}</span><strong className="mt-1 block truncate text-sm text-bone">{row.label}</strong><p className="mt-1 text-xs text-muted">{row.positiveRate}% positive · {row.meetings} meetings · {row.sent} sent</p></div>)}</div></div> : null}
        </div>
      </section> : null}

      {!loading && tab === "replies" ? <section>
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-edge bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-display text-lg text-bone">Reply inbox</h2><p className="mt-1 text-sm text-muted">Every reply stops the sequence. Interested people become CRM opportunities and can receive an approved booking reply.</p></div><button onClick={checkReplies} disabled={!!busy} className={primary}>{busy === "replies" ? "Checking Gmail…" : "Check replies now"}</button></div>
        <div className="space-y-2">{replies.map((reply) => { const draft = reply.bookingDraft; const edit = draft ? draftEdits[draft.id] || { subject: draft.subject, body_text: draft.body_text } : null; return <article key={reply.id} className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-display text-lg text-bone">{reply.first_name} {reply.last_name}</h3><p className="text-sm text-bone/80">{reply.company_name}</p></div><span className={`rounded-full border px-2 py-1 font-mono text-[0.55rem] uppercase ${reply.reply_category === "interested" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{reply.reply_category}</span></div>
          <p className="mt-3 text-sm leading-6 text-bone/80">{reply.reply_summary}</p>
          {reply.reply_category === "interested" && !draft ? <button onClick={() => prepareBookingReply(reply.id)} disabled={!!busy} className={`${primary} mt-3 w-full sm:w-auto`}>{busy === `booking:${reply.id}` ? "Drafting…" : "Prepare booking reply"}</button> : null}
          {draft && edit ? <div className="mt-4 space-y-3 border-t border-edge pt-4"><div className="rounded-lg border border-moss/35 bg-moss/[0.06] px-3 py-2 text-sm text-moss">This is still a draft. Review the exact words and calendar link before approval.</div><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Reply subject</span><input className={input} value={edit.subject} onChange={(e) => setMessage(draft.id, { subject: e.target.value })} disabled={draft.status === "sent"} /></label><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Reply</span><textarea className={`${input} min-h-40 resize-y leading-6`} value={edit.body_text} onChange={(e) => setMessage(draft.id, { body_text: e.target.value })} disabled={draft.status === "sent"} /></label><div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><button onClick={() => saveDraft(draft.id)} disabled={!!busy || draft.status === "sent"} className={button}>Save changes</button>{draft.status === "draft" || draft.status === "failed" ? <button onClick={() => saveDraft(draft.id, true)} disabled={!!busy} className={primary}>Approve exact reply</button> : null}{draft.status === "approved" ? <button onClick={() => send(draft.id)} disabled={!!busy} className={primary}>Send booking reply</button> : null}{draft.status === "sent" ? <span className="self-center font-mono text-xs uppercase text-moss">✓ Booking link sent</span> : null}</div></div> : null}
          <a href={`mailto:${reply.email}`} className="mt-3 inline-block font-mono text-xs text-amber">Open in Gmail ↗</a>
        </article>; })}{!replies.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">No replies detected yet.</div> : null}</div>
      </section> : null}

      {!loading && tab === "safety" ? <section className="space-y-4"><div className="rounded-xl border border-moss/40 bg-moss/10 p-4"><h2 className="font-display text-lg text-bone">Safety rules are active</h2><ul className="mt-3 space-y-2 text-sm text-bone/80"><li>• Nothing sends without approval of that exact draft.</li><li>• Every email is forced through Lee Nazari &lt;lee@interviewa.com&gt;.</li><li>• Maximum 20 sends per London calendar day.</li><li>• Existing CRM companies, replies and blocked addresses stop outreach.</li><li>• Only one person per company enters a daily queue.</li><li>• No tracking pixels or hidden open tracking.</li></ul></div><div className="rounded-xl border border-edge bg-panel p-4"><h2 className="font-display text-lg text-bone">Do-not-contact list</h2><p className="mt-1 text-sm text-muted">Block a person’s email or an entire company domain.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className={input} value={blockTarget} onChange={(e) => setBlockTarget(e.target.value)} placeholder="person@company.com or company.com" /><button onClick={addSuppression} disabled={!!busy || !blockTarget.trim()} className={primary}>Block</button></div><div className="mt-4 space-y-2">{suppressions.map((item) => <div key={item.target} className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink/30 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm text-bone">{item.target}</p><p className="text-xs text-muted">{item.reason}</p></div><span className="font-mono text-[0.54rem] uppercase text-muted">{item.kind}</span></div>)}</div></div></section> : null}
    </main>
  );
}
