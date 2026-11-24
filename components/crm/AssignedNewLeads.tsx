'use client';
import { engagementLabel } from '@/lib/sales-lead-events';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import NavMenu from '@/components/crm/NavMenu';
import SalesJourneySwitch from '@/components/crm/SalesJourneySwitch';
import { DemoLink, LeadDetails } from '@/components/crm/AssignedLeadDetails';
import { readLeadListFilters, writeLeadListFilters } from '@/lib/lead-list-navigation';
import { clearCrmCache, crmFetch } from '@/lib/crm';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_VIEWS, LEAD_VIEW_LABELS, type AssignedLead, type AssignedLeadList } from '@/lib/assigned-new-leads';

const button = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-edge px-3 py-2 text-sm hover:border-amber disabled:opacity-40';
const input = 'min-h-10 rounded-lg border border-edge bg-panel px-3 text-sm';
const LeadWorkspace = dynamic(() => import('@/components/crm/LeadWorkspace'), {
  ssr: false,
  loading: () => <p role="status" className="fixed bottom-6 right-6 z-50 rounded-lg border border-amber/40 bg-panel p-4 text-sm text-amber">Opening lead workspace…</p>,
});

// The same scoped projection makes the holding page visible in the actual client
// file too, without disclosing any private attributes of an existing record.
export function ImportedClientLead({ companyId }: { companyId: string }) {
  const [lead, setLead] = useState<AssignedLead | null>(null);
  useEffect(() => { let active = true; setLead(null); void crmFetch<AssignedLeadList>(`/api/crm/new-leads?companyId=${encodeURIComponent(companyId)}`).then(data => { if (active) setLead(data.leads[0] || null); }).catch(() => {}); return () => { active = false; }; }, [companyId]);
  if (!lead) return null;
  return <section className="mb-4 rounded-xl border border-amber/30 bg-panel p-4" aria-label="Imported lead information"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">New lead · {lead.ownerName}</h2><p className="mt-1 text-xs text-muted">{LEAD_STATUS_LABELS[lead.status]} · Added to source {lead.sourceDate || 'date not supplied'}</p></div><DemoLink lead={lead} /></div><details className="mt-3"><summary className="cursor-pointer text-sm text-amber">Notes, sent dates and evidence</summary><LeadDetails lead={lead} /></details></section>;
}

export default function AssignedNewLeads({ onOpenInbound }: { onOpenInbound: () => void }) {
  const [data, setData] = useState<AssignedLeadList | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [page, setPage] = useState(1), [owner, setOwner] = useState(''), [status, setStatus] = useState(''), [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [view, setView] = useState('all'), [demo, setDemo] = useState('any'), [contact, setContact] = useState('any'), [sort, setSort] = useState('newest');
  const [refresh, setRefresh] = useState(0), [canReview, setCanReview] = useState(false);
  const [filtersReady, setFiltersReady] = useState(false);
  const [selection, setSelection] = useState<{ leads: AssignedLead[]; index: number; emailHistoryAvailable?: boolean } | null>(null);
  useEffect(() => {
    const restore = () => {
      const saved = readLeadListFilters(new URLSearchParams(window.location.search));
      setPage(saved.page); setOwner(saved.owner); setStatus(saved.status); setSearch(saved.query); setQuery(saved.query);
      setView(saved.view); setDemo(saved.demo); setContact(saved.contact); setSort(saved.sort); setFiltersReady(true);
    };
    restore(); window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (!filtersReady) return;
    const params = writeLeadListFilters(new URLSearchParams(window.location.search), { page, owner, status, query, view, demo, contact, sort });
    const target = `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', target);
  }, [filtersReady, page, owner, status, query, view, demo, contact, sort]);
  useEffect(() => { let active = true; void crmFetch<{ canReview: boolean }>('/api/crm/inbound-leads/access').then(v => { if (active) setCanReview(v.canReview); }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!filtersReady) return;
    let active = true; setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), owner, status, search: query, view, demo, contact, sort });
    void crmFetch<AssignedLeadList>(`/api/crm/new-leads?${params}`).then(v => { if (active) setData(v); }).catch(e => { if (active) { setData(null); setError(e.message || 'Your leads could not be loaded'); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filtersReady, page, owner, status, query, view, demo, contact, sort, refresh]);
  const filtered = !!(owner || status || query || view !== 'all' || demo !== 'any' || contact !== 'any');
  const reset = useCallback(() => { setOwner(''); setStatus(''); setSearch(''); setQuery(''); setView('all'); setDemo('any'); setContact('any'); setSort('newest'); setPage(1); }, []);
  return <><NavMenu /><main className="mx-auto max-w-7xl px-4 pb-28 pt-7 sm:px-7">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-amber">Your assigned sales work</p><h1 className="mt-2 text-3xl font-semibold">New leads</h1><p className="mt-2 text-sm text-muted">{data?.isOwner ? 'All assigned leads. Filter by salesperson to see their list.' : 'Your leads, contact details and personalised demo pages in one place.'}</p><p className="mt-1 text-xs text-muted">Leads and pipeline share the same companies and contacts. Confirm buyer interest to add an opportunity.</p></div><div className="flex flex-wrap gap-2"><Link className={`${button} border-amber/40 text-amber`} href="/crm/outreach?tab=prospects#import-leads">Upload to Outreach</Link>{canReview && <button className={button} onClick={onOpenInbound}>Inbound enquiries</button>}<button className={button} disabled={loading} onClick={() => { clearCrmCache(); setRefresh(v => v + 1); }}>↻ Refresh</button></div></header>
    <SalesJourneySwitch active="leads" />
    <section className="mt-6 rounded-xl border border-edge bg-panel p-4" aria-label="Lead filters">
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Quick lead views">{LEAD_VIEWS.map(v => <button key={v} type="button" aria-pressed={view === v} className={`${button} ${view === v ? 'border-amber bg-amber/10 text-amber' : 'text-muted'}`} onClick={() => { setView(v); setStatus(''); setPage(1); }}>{LEAD_VIEW_LABELS[v]}{data && !loading ? ` · ${data.viewCounts[v] || 0}` : ''}</button>)}</div>
      {view === 'needs_details' && <p className="mb-4 text-xs text-muted">Missing a named contact, demo page, or both email and phone. Do-not-contact records are excluded.</p>}
      {view === 'follow_up' && <p className="mb-4 text-xs text-muted">Contacted or no-response leads from the sheet. These are not automatically due today. Do-not-contact records are excluded.</p>}
      <div className="flex flex-wrap items-center gap-3">
      <span className="mr-auto text-sm font-medium">{data ? `${data.total} matching · ${data.allCount} available` : 'Assigned leads'}</span>
      {data?.isOwner && <select className={input} aria-label="Assigned salesperson" value={owner} onChange={e => { setOwner(e.target.value); setPage(1); }}><option value="">All salespeople</option>{data.owners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      <select className={input} aria-label="Lead order" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="company">Company A–Z</option></select>
      <form role="search" className="flex w-full gap-2 sm:w-auto" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); setPage(1); }}><input type="search" className={`${input} min-w-0 flex-1 sm:w-64`} aria-label="Search leads" placeholder="Company, contact or email…" maxLength={160} value={search} onChange={e => setSearch(e.target.value)} /><button className={button}>Search</button></form>
      {(filtered || sort !== 'newest') && <button className="text-sm text-muted underline" onClick={reset}>Clear filters</button>}
    </div>
      <details className="mt-4 border-t border-edge pt-3"><summary className="cursor-pointer text-sm text-amber">More filters{[status, demo !== 'any' ? demo : '', contact !== 'any' ? contact : ''].filter(Boolean).length ? ` · ${[status, demo !== 'any' ? demo : '', contact !== 'any' ? contact : ''].filter(Boolean).length} active` : ''}</summary><div className="mt-3 flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs text-muted">Contact status<select className={input} aria-label="Contact status" value={status} onChange={e => { setStatus(e.target.value); setView('all'); setPage(1); }}><option value="">All contact statuses</option>{LEAD_STATUSES.map(s => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted">Demo page<select className={input} aria-label="Demo page" value={demo} onChange={e => { setDemo(e.target.value); setPage(1); }}><option value="any">Any demo status</option><option value="available">Demo link available</option><option value="opened">Demo opened</option><option value="missing">Demo link missing</option></select></label>
        <label className="grid gap-1 text-xs text-muted">Contact details<select className={input} aria-label="Contact details" value={contact} onChange={e => { setContact(e.target.value); setPage(1); }}><option value="any">Any contact details</option><option value="email">Has email</option><option value="phone">Has phone</option><option value="missing">No email or phone</option></select></label>
      </div><p className="mt-3 text-xs text-muted">Source status comes from the uploaded sheet. Demo engagement and your recorded emails are shown separately. Each row links to the same company record.</p></details>
    </section>
    {error && <p role="alert" className="mt-4 rounded-lg border border-rust/40 bg-rust/10 p-4 text-sm text-rust">{error}</p>}
    <section aria-label="Assigned lead list" aria-busy={loading} className="mt-4 space-y-3">
      {loading ? <p role="status" className="p-8 text-center text-muted">Loading your leads…</p> : data?.leads.length ? <div className="overflow-hidden rounded-xl border border-edge bg-panel">
        <div aria-hidden="true" className="hidden gap-5 border-b border-edge bg-ink/50 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]"><span>Company</span><span>Contact</span><span>Status and activity</span><span className="w-32">Workspace</span></div>
        {data.leads.map((lead, index) => <article key={lead.id} className="grid min-w-0 items-center gap-3 border-b border-edge p-4 last:border-b-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:gap-5 lg:px-5">
          <div className="min-w-0"><button className="min-h-11 text-left text-lg font-semibold leading-snug hover:text-amber hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber" onClick={() => setSelection({ leads: data.leads, index, emailHistoryAvailable: data.emailHistoryAvailable })} aria-label={`Open workspace for ${lead.companyName}`}>{lead.companyName}</button><p className="mt-1 text-xs text-muted">{lead.ownerName} · Added {lead.sourceDate || 'date not supplied'}</p><p className="mt-1 truncate text-xs text-muted">Campaign · {lead.campaign || 'Not recorded'}</p></div>
          <div className="min-w-0"><p className="text-sm font-medium">{lead.contactName || 'Contact to confirm'}</p><p className="mt-1 truncate text-xs text-muted">{lead.email || lead.phone || 'No email or phone'}</p>{lead.holdingPageUrl && <a className="mt-1 inline-flex min-h-9 items-center text-sm text-amber hover:underline" href={lead.holdingPageUrl} target="_blank" rel="noopener noreferrer">Demo page ↗</a>}</div>
          <div className="min-w-0 text-xs"><span className={`inline-block rounded-full border px-2.5 py-1 ${['on_hold', 'not_interested'].includes(lead.status) ? 'border-rust/40 text-rust' : lead.status === 'new' ? 'border-sage/40 text-sage' : 'border-sky/40 text-sky'}`}>Sheet · {LEAD_STATUS_LABELS[lead.status]}</span><p className="mt-2 text-muted">{engagementLabel(lead.activity) === 'No tracked activity' ? 'No demo or reply event recorded' : engagementLabel(lead.activity)}</p>{lead.restriction && <p className="mt-1 text-rust">Contact restriction recorded</p>}</div>
          <button className={`${button} min-h-11 border-amber/40 text-amber lg:w-32`} aria-label={`Work on ${lead.companyName}`} onClick={() => setSelection({ leads: data.leads, index, emailHistoryAvailable: data.emailHistoryAvailable })}>Open workspace →</button>
        </article>)}
      </div> : !error && <div className="rounded-xl border border-edge bg-panel p-10 text-center"><h2 className="text-xl">{filtered ? 'No matching leads' : 'No leads assigned yet'}</h2><p className="mt-2 text-sm text-muted">{filtered ? 'Try clearing the filters.' : 'Leads assigned to your account will appear here.'}</p></div>}
    </section>
    {data && <footer className="mt-5 flex items-center justify-between gap-2 text-sm text-muted"><span>Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} · 25 per page</span><div className="flex gap-2"><button className={button} disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><button className={button} disabled={loading || page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></div></footer>}
  </main>{selection && <LeadWorkspace leads={selection.leads} initialIndex={selection.index} emailHistoryAvailable={selection.emailHistoryAvailable !== false} onClose={() => { setSelection(null); }} />}</>;
}
