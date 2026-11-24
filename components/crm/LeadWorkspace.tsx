'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { clearCrmCache, crmFetch } from '@/lib/crm';
import { LEAD_STATUS_LABELS, type AssignedLead } from '@/lib/assigned-new-leads';
import { leadDate, type LeadFormState, type LeadWorkspace as WorkspaceData } from '@/lib/lead-workspace';
import { DemoLink, LeadDetails, PipelineAction, leadButton } from '@/components/crm/AssignedLeadDetails';
import CompanyEmailHistory from '@/components/crm/CompanyEmailHistory';
import LeadNoteForm from '@/components/crm/LeadNoteForm';
import TaskComposer from '@/components/crm/TaskComposer';

const cleanForm: LeadFormState = { dirty: false, busy: false, listening: false };

export default function LeadWorkspace({ leads, initialIndex, emailHistoryAvailable, onClose }: {
  leads: AssignedLead[]; initialIndex: number; emailHistoryAvailable: boolean; onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex), [form, setForm] = useState(cleanForm), [pipelineBusy, setPipelineBusy] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lead = leads[index];
  const busy = form.busy || pipelineBusy;
  // Form effects can report a completed save before React commits the parent
  // render. Guards read this synchronously updated state, not a stale render.
  const guard = useRef({ form: cleanForm, pipelineBusy: false });
  const closeRequest = useRef<() => void>(() => {});
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const cancel = (event: Event) => { event.preventDefault(); closeRequest.current(); };
    dialog?.addEventListener('cancel', cancel);
    dialog?.showModal(); document.body.style.overflow = 'hidden';
    return () => {
      dialog?.removeEventListener('cancel', cancel);
      dialog?.close(); document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      const current = guard.current;
      if (current.form.dirty || current.form.listening || current.form.busy || current.pipelineBusy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);
  const canLeave = () => {
    const current = guard.current;
    if (current.form.busy || current.pipelineBusy) { setNavigationNotice('Wait for the save result before leaving this lead.'); return false; }
    return (!current.form.dirty && !current.form.listening) || window.confirm('Discard your unsaved update and leave this lead?');
  };
  const close = () => { if (canLeave()) onClose(); };
  // Subscribe to native cancel once, but always use this render's guard. Escape
  // must not retain a dirty-state closure from an earlier lead or saved form.
  useLayoutEffect(() => { closeRequest.current = close; });
  const move = (next: number) => {
    if (next < 0 || next >= leads.length || !canLeave()) return;
    guard.current.form = cleanForm;
    setIndex(next); setForm(cleanForm); setNavigationNotice('');
    dialogRef.current?.querySelector('[data-workspace-scroll]')?.scrollTo?.(0, 0);
  };
  const updateForm = useCallback((state: LeadFormState) => { guard.current.form = state; setForm(state); }, []);
  const updatePipelineBusy = useCallback((value: boolean) => { guard.current.pipelineBusy = value; setPipelineBusy(value); }, []);
  return <dialog ref={dialogRef} aria-labelledby="lead-workspace-title" className="m-auto h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden border border-edge bg-ink p-0 text-bone backdrop:bg-black/70 sm:h-[92dvh] sm:max-w-6xl sm:rounded-2xl">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge bg-panel px-4 py-4 sm:px-6">
        <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-widest text-amber">Lead workspace</p><h2 id="lead-workspace-title" className="mt-1 break-words font-display text-2xl sm:text-3xl">{lead.companyName}</h2><p className="mt-1 text-sm text-muted">Assigned to {lead.ownerName}</p></div>
        <button autoFocus type="button" className={`${leadButton} shrink-0`} onClick={close} aria-label="Close lead workspace">Close ×</button>
      </header>
      <div data-workspace-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        <WorkspaceContent key={lead.id} selected={lead} emailHistoryAvailable={emailHistoryAvailable} onFormState={updateForm} onPipelineBusy={updatePipelineBusy} />
      </div>
      <footer className="shrink-0 border-t border-edge bg-panel px-4 py-3 sm:px-6">
        {navigationNotice && <p role="status" className="mb-2 text-sm text-amber">{navigationNotice}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Lead {index + 1} of {leads.length} on this page</p><div className="flex gap-2"><button type="button" className={leadButton} disabled={busy || index === 0} onClick={() => move(index - 1)}>← Previous lead</button><button type="button" className={`${leadButton} border-amber/50 text-amber`} disabled={busy || index === leads.length - 1} onClick={() => move(index + 1)}>Next lead →</button></div></div>
      </footer>
    </div>
  </dialog>;
}

function WorkspaceContent({ selected, emailHistoryAvailable, onFormState, onPipelineBusy }: {
  selected: AssignedLead; emailHistoryAvailable: boolean; onFormState: (state: LeadFormState) => void; onPipelineBusy: (busy: boolean) => void;
}) {
  const [data, setData] = useState<WorkspaceData | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [mode, setMode] = useState<'note' | 'phone' | 'task' | null>(null);
  const [formState, setFormState] = useState(cleanForm);
  const [contactOpen, setContactOpen] = useState(false);
  const historyRef = useRef<HTMLElement>(null);
  const logRef = useRef<HTMLElement>(null);
  const lead = data?.lead;
  useEffect(() => { if (mode) logRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [mode]);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void crmFetch<WorkspaceData>(`/api/crm/new-leads/${selected.id}/workspace`)
      .then(result => { if (active) { if (result.lead?.id !== selected.id) throw new Error('The workspace did not return the selected lead. Reopen it from your list.'); setData(result); } })
      .catch(caught => { if (active) setError(caught.message || 'The workspace could not be loaded. Try loading it again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selected.id, refresh]);
  const updateForm = useCallback((state: LeadFormState) => { setFormState(state); onFormState(state); }, [onFormState]);
  const saved = useCallback(() => {
    clearCrmCache(); setRefresh(value => value + 1);
    window.dispatchEvent(new CustomEvent('lc:crm-updated'));
    window.dispatchEvent(new CustomEvent('lc:client-context-updated', { detail: { companyId: selected.id } }));
  }, [selected.id]);
  const changeMode = (next: typeof mode) => {
    if (formState.busy || next === mode) return;
    if ((formState.dirty || formState.listening) && !window.confirm('Discard your unsaved update and switch action?')) return;
    setMode(next); updateForm(cleanForm);
  };
  const checkHistory = () => { setRefresh(value => value + 1); historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <>
    {loading && <p role="status" className="mb-4 text-sm text-muted">{data ? 'Refreshing saved activity…' : 'Opening the current record…'}</p>}
    {error && <div role="alert" className="mb-4 rounded-lg border border-rust/40 bg-rust/10 p-4 text-sm"><p className="text-rust">{error}</p>{data && <p className="mt-2">Previously loaded details are still shown. Your unsaved text has been kept.</p>}<button className={`${leadButton} mt-3`} disabled={loading} onClick={() => setRefresh(value => value + 1)}>Reload workspace</button></div>}
    {lead && data && <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-5 border-b border-edge pb-5 lg:border-b-0 lg:border-r lg:pr-6">
        <section aria-label="Lead contact"><p className="text-xs font-medium uppercase tracking-wider text-muted">Contact</p><h3 className="mt-2 text-lg font-semibold">{lead.contactName || 'Contact to confirm'}</h3>{lead.contactRole && <p className="mt-1 text-sm text-muted">{lead.contactRole}</p>}<button className={`${leadButton} mt-2 lg:hidden`} aria-expanded={contactOpen} aria-controls="lead-contact-details" onClick={() => setContactOpen(value => !value)}>{contactOpen ? 'Hide contact details' : 'Contact details and links'}</button></section>
        <div id="lead-contact-details" className={`${contactOpen ? '' : 'hidden'} space-y-5 lg:block`}>
        <div className="space-y-2 text-sm">{lead.email && <p className="break-all">{['on_hold', 'not_interested'].includes(lead.status) ? lead.email : <a className="text-amber underline" href={`mailto:${lead.email}`}>{lead.email}</a>}</p>}{lead.phone && <p className="break-words">{lead.phone}</p>}{!lead.email && !lead.phone && <p className="text-muted">No email or phone supplied</p>}</div>
        <div className="space-y-2 text-sm"><p className="text-muted">Sheet status</p><span className={`inline-block rounded-full border px-3 py-1 ${['on_hold', 'not_interested'].includes(lead.status) ? 'border-rust/50 text-rust' : 'border-sky/40 text-sky'}`}>{LEAD_STATUS_LABELS[lead.status]}</span><p className="pt-2 text-muted">CRM stage · <span className="text-bone">{lead.stage || 'New'}</span></p><p className="text-muted">Campaign · {lead.campaign || 'Not recorded'}</p><p className="text-muted">Source added · {lead.sourceDate || 'Not supplied'}</p></div>
        {lead.restriction && <p className="rounded-lg border border-rust/40 bg-rust/10 p-3 text-sm text-rust">{lead.restriction}</p>}
        <div className="flex flex-wrap gap-2 lg:flex-col"><DemoLink lead={lead} /><PipelineAction lead={lead} onSaved={saved} onBusyChange={onPipelineBusy} /><Link className={leadButton} href={`/crm/${lead.id}`} target="_blank" rel="noopener noreferrer">Full company record ↗</Link></div>
        <p className="text-xs leading-relaxed text-muted">This is the existing company record. Full record, demo and pipeline links open in a new tab so you keep your place here.</p>
        </div>
      </aside>
      <div className="min-w-0 space-y-6">
        <section aria-label="Next action" className="rounded-xl border border-sky/35 bg-sky/[0.05] p-4">
          <h3 className="text-lg font-semibold">Next action</h3>
          {data.opportunity?.nextAction && <div className="mt-3"><p className="text-xs text-sky">Saved deal next step · {data.opportunity.stage.replace(/_/g, ' ')}</p><p className="mt-1 break-words text-base leading-relaxed">{data.opportunity.nextAction}</p><p className="mt-1 text-sm text-muted">{leadDate(data.opportunity.dueAt)}</p></div>}
          {data.tasks.length > 0 ? <div className="mt-3"><p className="mb-2 text-sm font-medium">Your open tasks</p><ul className="space-y-2">{data.tasks.map(task => <li key={task.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-edge pt-2 text-sm"><Link href={`/crm/${lead.id}#sec-tasks`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-words text-amber hover:underline">{task.text} ↗</Link><span className="text-muted">{leadDate(task.dueAt)}</span></li>)}</ul>{data.limited.tasks && <p className="mt-2 text-xs text-muted">Showing your next 8 tasks. Open the company record for the rest.</p>}</div> : <p className="mt-2 text-sm text-muted">No open tasks in your account for this lead. Add the next step when you know it.</p>}
        </section>
        <section ref={logRef} aria-label="Log an update"><h3 className="text-lg font-semibold">Log an update</h3><div className="my-3 flex flex-wrap gap-2">{(['note', 'phone', 'task'] as const).map(value => <button key={value} className={`${leadButton} ${mode === value ? 'border-amber/50 bg-amber/10 text-amber' : ''}`} aria-pressed={mode === value} disabled={formState.busy} onClick={() => changeMode(value)}>{value === 'note' ? 'Add note' : value === 'phone' ? 'Log call' : 'Add task'}</button>)}</div>
          {!mode && <p className="text-sm text-muted">Record what happened or set a follow-up. Nothing is generated until you choose an action.</p>}
          {(mode === 'note' || mode === 'phone') && <LeadNoteForm key={mode} companyId={lead.id} channel={mode} onSaved={saved} onStateChange={updateForm} onCheckHistory={checkHistory} />}
          {mode === 'task' && <div className="[&_button]:text-sm [&_p]:text-sm [&_span]:text-xs"><TaskComposer fixedCompany={{ id: lead.id, name: lead.companyName }} initiallyOpen onSaved={saved} onFormStateChange={updateForm} /></div>}
        </section>
        <section ref={historyRef} aria-label="Your recent notes" className="border-t border-edge pt-5"><h3 className="text-lg font-semibold">Your recent notes</h3><p className="mt-1 text-xs text-muted">Only notes logged by your account, newest first. Shared source notes are below.</p>{data.notes.length ? <div className="mt-3 space-y-2">{data.notes.map(note => <details key={note.id} className="rounded-lg border border-edge bg-panel px-3 py-2"><summary className="min-h-10 cursor-pointer py-2 text-sm"><span className="font-medium">{note.title}</span><time className="ml-2 text-muted" dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><span className="mt-1 block truncate text-muted">{note.content.slice(0, 140)}</span></summary><p className="whitespace-pre-wrap break-words pb-2 text-sm leading-relaxed">{note.content}</p></details>)}</div> : <p className="mt-3 text-sm text-muted">No notes logged by you for this lead yet.</p>}{data.limited.notes && <p className="mt-2 text-xs text-muted">Showing your latest 12 notes. Older notes remain in the company record.</p>}</section>
        <CompanyEmailHistory companyId={lead.id} recent={selected.recentEmail} available={emailHistoryAvailable} />
        <details className="border-t border-edge pt-4"><summary className="min-h-11 cursor-pointer text-sm text-amber">Source research, imported notes and dates</summary><LeadDetails lead={lead} /></details>
      </div>
    </div>}
  </>;
}
