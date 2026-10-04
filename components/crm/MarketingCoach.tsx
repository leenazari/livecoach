'use client';
import { useEffect, useRef, useState } from 'react';
import { MARKETING_LESSONS, OWN_APPROACH, type MarketingSection, type MarketingTask } from '@/lib/marketing';
import { crmFetch } from '@/lib/crm';
export default function MarketingCoach({ section, evidence, canManage, selectedTask, onSaved }: { section: MarketingSection; evidence: string; canManage: boolean; selectedTask: MarketingTask | null; onSaved: () => Promise<void> }) {
  const lesson = MARKETING_LESSONS[section];
  const [approachId, setApproachId] = useState(lesson.approaches[0].id);
  const [own, setOwn] = useState('');
  const [measure, setMeasure] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [walking, setWalking] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [simple, setSimple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    const p = selectedTask?.payload;
    const valid = [...lesson.approaches, OWN_APPROACH].some(a => a.id === p?.approach);
    setApproachId(valid ? String(p?.approach) : lesson.approaches[0].id);
    setOwn(typeof p?.ownApproach === 'string' ? p.ownApproach : '');
    setMeasure(typeof p?.measure === 'string' ? p.measure : '');
    setDueOn(typeof p?.dueOn === 'string' ? p.dueOn : '');
    setWalking(Boolean(selectedTask)); setStepIndex(0); setSimple(false); setMessage(''); requestId.current = null;
  }, [section, selectedTask, lesson]);
  const approaches = [...lesson.approaches, OWN_APPROACH];
  const approach = approaches.find(a => a.id === approachId) || approaches[0];
  const step = approach.steps[stepIndex];
  const changed = () => { requestId.current = null; setMessage(''); };
  const save = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      requestId.current ||= crypto.randomUUID();
      await crmFetch('/api/crm/marketing', { method: 'POST', body: JSON.stringify({ action: 'plan', section, approach: approach.id, ownApproach: own, measure, dueOn, requestId: requestId.current }) });
      setMessage('Saved to your marketing plan and Tasks.'); await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The plan could not be saved'); }
    finally { setBusy(false); }
  };
  const askBrain = () => window.dispatchEvent(new CustomEvent('lc:open-brain', { detail: { prompt: `Coach me through this marketing decision, one point at a time. Explain why, give alternatives, and let me choose. Do not send messages, launch campaigns or spend budget without my instruction. Section: ${lesson.title}. Current recorded evidence (not a forecast): ${evidence.slice(0, 1500)}. My chosen approach: ${approach.name}. My idea: ${own.slice(0, 600)}. Success measure: ${measure.slice(0, 500)}. Please help with the next practical step and ask one question if necessary.` } }));
  return <section className="rounded-2xl border border-amber/35 bg-amber/[0.05] p-5" aria-label="Marketing coaching">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-wider text-amber">Brain · Marketing coach</p><h2 className="mt-2 font-display text-xl">{lesson.title}</h2></div><span className="text-xs text-muted">You choose the approach</span></div>
    <p className="mt-3 text-sm text-muted">{lesson.purpose}</p><p className="mt-2 text-sm">{evidence}</p>
    <div className="mt-4 grid gap-3 md:grid-cols-3" role="group" aria-label="Choose an approach">{approaches.map(a => <button key={a.id} type="button" disabled={busy} aria-pressed={a.id === approach.id} onClick={() => { setApproachId(a.id); setStepIndex(0); setSimple(false); changed(); }} className={`min-h-24 rounded-xl border p-4 text-left disabled:opacity-50 ${a.id === approach.id ? 'border-amber bg-amber/10' : 'border-edge bg-panel hover:border-amber/50'}`}><span className="text-sm font-medium">{a.name}</span><span className="mt-2 block text-xs text-muted">{a.tradeoff}</span></button>)}</div>
    {approach.id === 'own' && <label className="mt-4 block text-sm">How would you approach this?<textarea value={own} onChange={e => { setOwn(e.target.value); changed(); }} maxLength={600} className="mt-2 w-full rounded-xl border border-edge bg-panel p-3 text-base" placeholder="I would start by…" /></label>}
    <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => { setWalking(true); setStepIndex(0); setSimple(false); }} className="min-h-11 rounded-full bg-amber px-5 py-3 text-sm font-medium text-ink">Talk me through this</button><button type="button" onClick={askBrain} className="min-h-11 rounded-full border border-edge px-4 py-3 text-sm">Ask Brain for more help</button></div>
    {walking && <div className="mt-4 rounded-xl border border-edge bg-panel p-4" aria-live="polite"><p className="text-xs text-amber">Step {stepIndex + 1} of {approach.steps.length}</p><h3 className="mt-2 font-medium">{step.title}</h3><p className="mt-2 text-sm">{simple ? step.simple : step.detail}</p><p className="mt-2 text-xs text-muted">Outcome: {step.output}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={stepIndex === 0} onClick={() => { setStepIndex(i => i - 1); setSimple(false); }} className="rounded-lg border border-edge px-3 py-2 text-sm disabled:opacity-40">Back</button><button type="button" onClick={() => { if (stepIndex + 1 < approach.steps.length) { setStepIndex(i => i + 1); setSimple(false); } else setWalking(false); }} className="rounded-lg border border-edge px-3 py-2 text-sm">{stepIndex + 1 === approach.steps.length ? 'Finish' : 'Next step'}</button><button type="button" onClick={() => setSimple(v => !v)} className="px-3 py-2 text-sm text-amber">{simple ? 'Show detail' : 'Explain more simply'}</button><button type="button" onClick={() => { setStepIndex(0); setSimple(false); }} className="px-3 py-2 text-sm text-amber">Start again</button></div></div>}
    {canManage && <form onSubmit={e => { e.preventDefault(); void save(); }} className="mt-5 border-t border-edge pt-4"><div className="grid gap-3 md:grid-cols-[1fr_180px]"><label className="text-sm">How will you measure success?<input required value={measure} maxLength={500} onChange={e => { setMeasure(e.target.value); changed(); }} placeholder="e.g. sales accept 5 suitable leads" className="mt-2 min-h-11 w-full rounded-lg border border-edge bg-panel px-3 text-base" /></label><label className="text-sm">Review date · London<input required type="date" value={dueOn} onChange={e => { setDueOn(e.target.value); changed(); }} className="mt-2 min-h-11 w-full rounded-lg border border-edge bg-panel px-3 text-base" /></label></div><button disabled={busy || (approach.id === 'own' && !own.trim())} className="mt-4 min-h-11 rounded-full border border-sage/50 bg-sage/10 px-5 py-2 text-sm text-sage disabled:opacity-50">{busy ? 'Saving…' : 'Use this approach in my plan'}</button></form>}
    <p className="mt-3 text-xs text-muted">Repeat the walkthrough whenever you need it. Walkthroughs use no AI calls. Asking Brain uses the existing AI usage controls.</p>{message && <p role="status" className="mt-3 text-sm text-sage">{message}</p>}
  </section>;
}
