'use client';
import { useEffect, useId, useState } from 'react';
import { crmFetch } from '@/lib/crm';
import { recordedEmailDate, type RecordedCompanyEmail, type RecordedCompanyEmailHistory } from '@/lib/recorded-company-emails';

export default function CompanyEmailHistory({ companyId, recent, available = true }: {
  companyId: string; recent?: RecordedCompanyEmail; available?: boolean;
}) {
  const panelId = useId();
  const [openCompany, setOpenCompany] = useState('');
  const open = openCompany === companyId;
  const [history, setHistory] = useState<(RecordedCompanyEmailHistory & { companyId: string }) | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState<'saved' | 'mailbox'>('saved');
  const summary = history?.companyId === companyId ? history.messages[0] : recent?.companyId === companyId ? recent : undefined;
  useEffect(() => {
    let active = true;
    setError('');
    if (!open) { setLoading(false); return; }
    setHistory(null);
    setLoading(true);
    void crmFetch<RecordedCompanyEmailHistory>(`/api/crm/companies/${encodeURIComponent(companyId)}/emails${source === 'mailbox' ? '?source=mailbox' : ''}`)
      .then(value => { if (active) setHistory({ ...value, companyId }); })
      .catch(e => { if (active) setError(e.message || 'Your recorded emails could not be loaded. Try opening the history again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, open, refresh, source]);
  return <section className="mt-4 rounded-lg border border-sky/25 bg-sky/[0.04] p-3" aria-label="Your email history">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-sky">Your email history</p>
        {summary ? <><p className="mt-1 break-words text-sm text-bone">{summary.subject}</p><p className="mt-1 text-xs text-muted">{summary.direction === 'sent' ? 'Sent' : 'Received'} · {recordedEmailDate(summary.at)}{summary.correspondent ? ` · ${summary.correspondent}` : ''}</p></> : <p className="mt-1 text-xs text-muted">{available ? 'No email shown in the recent CRM history. This does not mean the lead has never been contacted.' : 'Email preview unavailable. Open the history to try loading it again.'}</p>}
      </div>
      <button type="button" aria-expanded={open} aria-controls={panelId} className="min-h-10 shrink-0 rounded-lg border border-sky/40 px-3 py-2 text-sm text-sky hover:border-sky" onClick={() => { if (!open) setSource('saved'); setOpenCompany(open ? '' : companyId); }}>{open ? 'Close email history' : 'Read email history'}</button>
    </div>
    {open && <div id={panelId} className="mt-3 border-t border-edge pt-3">
      <p className="mb-3 text-xs leading-relaxed text-muted">{source === 'saved' ? 'Emails already saved in LiveCoach for your account. Other people’s mailboxes are not included. Uploaded sent dates are separate source notes, not proof of delivery.' : 'Checking only your connected mailbox against this lead’s exact saved contact email. Nothing is sent or added to the CRM.'}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" disabled={loading} className="min-h-10 rounded-lg border border-sky/40 px-3 text-sm text-sky disabled:opacity-40" onClick={() => { setSource('mailbox'); setRefresh(value => value + 1); }}>Check my connected mailbox</button>
        {source === 'mailbox' && <button type="button" disabled={loading} className="min-h-10 rounded-lg border border-edge px-3 text-sm disabled:opacity-40" onClick={() => setSource('saved')}>Show saved CRM emails</button>}
      </div>
      {loading && <p role="status" className="py-3 text-sm text-muted">{source === 'mailbox' ? 'Checking your mailbox…' : 'Loading your recorded emails…'}</p>}
      {error && <div role="alert" className="rounded-lg border border-rust/30 p-3 text-sm text-rust"><p>{error}</p><button className="mt-2 min-h-10 underline" onClick={() => setRefresh(value => value + 1)}>Reload email history</button></div>}
      {!loading && history?.companyId === companyId && <>
        {history.mailbox && <p className="mb-2 break-words text-xs text-sky">{history.mailbox} · Exact contact {history.matchedEmail}</p>}
        {history.limited && <p className="mb-3 text-xs text-muted">{history.searchScope || 'Showing a limited recent history. Older messages may not appear here.'}</p>}
        {!history.messages.length && <p className="py-3 text-sm text-muted">{source === 'mailbox' ? 'No matching messages were returned in this limited lookup. That does not prove there has been no contact. Check your mailbox directly for older correspondence or other contact addresses.' : 'No saved email messages are available for this company in your account. Check your connected mailbox for correspondence that has not been recorded in LiveCoach.'}</p>}
        <div className="max-h-[32rem] space-y-3 overflow-y-auto overscroll-contain pr-1" tabIndex={history.messages.length ? 0 : undefined} aria-label="Email messages">
          {history.messages.map(message => <article key={message.id} className="rounded-lg border border-edge bg-panel p-3">
            <p className="text-xs text-muted">{message.direction === 'sent' ? 'Sent' : 'Received'} · {recordedEmailDate(message.at)} · {message.source}</p>
            <h4 className="mt-1 break-words text-sm font-semibold">{message.subject}</h4>
            {message.correspondent && <p className="mt-1 break-all text-xs text-muted">{message.direction === 'sent' ? 'To' : 'From'} {message.correspondent}</p>}
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-bone/85">{message.text || 'The message text was not saved in this record.'}</p>
            {(message.truncated || message.direction === 'received') && <p className="mt-2 text-xs text-muted">{message.source === 'Connected mailbox' ? 'Mailbox preview, not the full conversation.' : 'Saved excerpt, not the full mailbox conversation.'}</p>}
          </article>)}
        </div>
      </>}
    </div>}
  </section>;
}
