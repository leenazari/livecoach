'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { clearCrmCache, crmFetch } from '@/lib/crm';
import type { AssignedLead } from '@/lib/assigned-new-leads';

export const leadButton = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-edge px-3 py-2 text-sm hover:border-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-40';

export function DemoLink({ lead }: { lead: AssignedLead }) {
  return lead.holdingPageUrl ? <a className={`${leadButton} border-amber/40 bg-amber/10 text-amber`} href={lead.holdingPageUrl} target="_blank" rel="noopener noreferrer">Open demo page ↗</a> : <span className="text-sm text-muted">Demo page not supplied</span>;
}

export function PipelineAction({ lead, onSaved, onBusyChange }: { lead: AssignedLead; onSaved?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [added, setAdded] = useState(false);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  if (lead.opportunityId || added) return <Link className={leadButton} href={`/crm/revenue?pipeline_search=${encodeURIComponent(lead.companyName)}`} target="_blank" rel="noopener noreferrer">View in pipeline ↗</Link>;
  return <><button className={leadButton} disabled={busy || ['on_hold', 'not_interested'].includes(lead.status)} onClick={async () => {
    setBusy(true); setError('');
    try {
      const result = await crmFetch<{ ok: boolean; opportunityId?: string; restricted?: boolean }>(`/api/crm/new-leads/${lead.id}/pipeline`, { method: 'POST', body: JSON.stringify({ confirmed: true }) });
      if (!result.opportunityId) throw new Error(result.restricted ? 'This lead is restricted. Review the company record before contacting.' : 'The opportunity was not confirmed. Check the pipeline before trying again.');
      setAdded(true); clearCrmCache(); onSaved?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>{busy ? 'Checking pipeline…' : 'Confirm sales opportunity'}</button>{error && <p role="alert" className="text-sm text-rust">{error}</p>}</>;
}

export function LeadDetails({ lead }: { lead: AssignedLead }) {
  return <div className="grid gap-5 pt-4 text-sm md:grid-cols-2">
    <div className="space-y-3">
      {lead.companyOverview && <p className="leading-relaxed text-muted">{lead.companyOverview}</p>}
      {lead.signal && <div><h4 className="mb-1 font-medium">Research from the sheet</h4><p className="whitespace-pre-wrap leading-relaxed text-muted">{lead.signal}</p>{lead.signalUrl && <a href={lead.signalUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-amber underline">View evidence ↗</a>}</div>}
      <div className="flex flex-wrap gap-4">{lead.website && <a className="text-amber underline" href={lead.website} target="_blank" rel="noopener noreferrer">Company website ↗</a>}{lead.linkedinUrl && <a className="text-amber underline" href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer">Contact LinkedIn ↗</a>}</div>
    </div>
    <div className="space-y-3">
      {lead.notes && <div><h4 className="mb-1 font-medium">Notes from the sheet</h4><p className="whitespace-pre-wrap break-words leading-relaxed text-muted">{lead.notes}</p></div>}
      {lead.emailHistory && <div><h4 className="mb-1 font-medium">Email dates recorded in the sheet</h4><p className="whitespace-pre-wrap break-words text-muted">{lead.emailHistory}</p></div>}
      {lead.demoOpened && <p className="text-sage">Demo activity · {lead.demoOpened}</p>}
      {lead.restriction && <p className="rounded-lg border border-rust/40 bg-rust/10 p-3 text-rust">{lead.restriction}</p>}
      <p className="text-xs text-muted">Sheet status · {lead.sourceStatus || 'Not recorded'}{lead.stage ? ` · CRM stage ${lead.stage}` : ''}</p>
    </div>
  </div>;
}
