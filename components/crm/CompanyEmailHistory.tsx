'use client';
import { useEffect, useId, useState } from 'react';
import { crmFetch } from '@/lib/crm';
import { LEAD_EMAIL_MESSAGE_LIMIT, recordedEmailDate, type RecordedCompanyEmail, type RecordedCompanyEmailHistory } from '@/lib/recorded-company-emails';

export default function CompanyEmailHistory({ companyId, recent, available = true, initiallyOpen = false, initialSource = 'saved', embedded = false }: {
  companyId: string; recent?: RecordedCompanyEmail; available?: boolean;
  initiallyOpen?: boolean; initialSource?: 'saved' | 'mailbox';
  embedded?: boolean;
}) {
  const panelId = useId();
  const [openCompany, setOpenCompany] = useState(initiallyOpen ? companyId : '');
  const open = embedded || openCompany === companyId;
  const [history, setHistory] = useState<(RecordedCompanyEmailHistory & { companyId: string; requestKey: string }) | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState<'saved' | 'mailbox'>(initialSource);
  const [contactId, setContactId] = useState('');
  const requestKey = `${companyId}:${source}:${contactId}:${refresh}`;
  const currentHistory = history?.requestKey === requestKey ? history : null;
  const summary = currentHistory?.messages[0] || (source === 'saved' && recent?.companyId === companyId ? recent : undefined);
  useEffect(() => {
    let active = true;
    setError('');
    if (!open) { setLoading(false); return; }
    setHistory(null);
    setLoading(true);
    void crmFetch<RecordedCompanyEmailHistory>(`/api/crm/companies/${encodeURIComponent(companyId)}/emails${source === 'mailbox' ? `?source=mailbox${contactId ? `&contactId=${encodeURIComponent(contactId)}` : ''}` : ''}`)
      .then(value => { if (active) setHistory({ ...value, companyId, requestKey }); })
      .catch(e => { if (active) setError(e.message || 'Your recorded emails could not be loaded. Try opening the history again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, open, refresh, source, contactId, requestKey]);
  return <section className="mt-4 rounded-lg border border-sky/25 bg-sky/[0.04] p-3" aria-label="Your email history">
    {!embedded && <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-sky">Your email history</p>
        {summary ? <><p className="mt-1 break-words text-sm text-bone">{summary.subject}</p><p className="mt-1 text-xs text-muted">{summary.direction === 'sent' ? 'Sent' : 'Received'} · {recordedEmailDate(summary.at)}{summary.correspondent ? ` · ${summary.correspondent}` : ''}</p></> : <p className="mt-1 text-xs text-muted">{source === 'mailbox' ? 'Your correspondence with this lead, without leaving the pipeline.' : available ? 'No email shown in the recent CRM history. This does not mean the lead has never been contacted.' : 'Email preview unavailable. Open the history to try loading it again.'}</p>}
      </div>
      <button type="button" aria-expanded={open} aria-controls={panelId} className="min-h-10 shrink-0 rounded-lg border border-sky/40 px-3 py-2 text-sm text-sky hover:border-sky" onClick={() => { if (!open) { setSource(initialSource); setContactId(''); } setOpenCompany(open ? '' : companyId); }}>{open ? 'Close email history' : 'Read email history'}</button>
    </div>}
    {open && <div id={panelId} className={embedded ? '' : 'mt-3 border-t border-edge pt-3'}>
      <p className="mb-3 text-xs leading-relaxed text-muted">{source === 'saved' ? 'Latest 12 emails already saved in LiveCoach for your account. Other people’s mailboxes are not included. Uploaded sent dates are separate source notes, not proof of delivery.' : 'Your mailbox only. Messages are read on demand, not copied into the CRM.'}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" disabled={loading} className="min-h-10 rounded-lg border border-sky/40 px-3 text-sm text-sky disabled:opacity-40" onClick={() => { setSource('mailbox'); setRefresh(value => value + 1); }}>{initialSource === 'mailbox' && source === 'mailbox' ? 'Refresh latest emails' : 'Check my connected mailbox'}</button>
        {source === 'mailbox' && <button type="button" disabled={loading} className="min-h-10 rounded-lg border border-edge px-3 text-sm disabled:opacity-40" onClick={() => setSource('saved')}>Show saved CRM emails</button>}
      </div>
      {loading && <p role="status" className="py-3 text-sm text-muted">{source === 'mailbox' ? 'Checking your mailbox…' : 'Loading your recorded emails…'}</p>}
      {error && <div role="alert" className="rounded-lg border border-rust/30 p-3 text-sm text-rust"><p>{error}</p><button className="mt-2 min-h-10 underline" onClick={() => setRefresh(value => value + 1)}>Reload email history</button></div>}
      {!loading && currentHistory && <>
        {currentHistory.contacts && currentHistory.contacts.length > 1 && <label className="mb-3 block text-sm text-muted">Contact
          <select aria-label="Email contact" className="mt-1 min-h-11 w-full rounded-lg border border-edge bg-ink px-3 text-bone" value={contactId || currentHistory.selectedContactId || ''} onChange={event => setContactId(event.target.value)}>
            <option value="" disabled>Choose the lead to view their emails</option>
            {currentHistory.contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.name || contact.email} · {contact.email}</option>)}
          </select>
        </label>}
        {currentHistory.contactRequired && <p role="status" className="py-3 text-sm text-amber">This company has more than one contact. Choose the person above so their conversations do not get mixed together.</p>}
        {currentHistory.mailbox && <p className="mb-2 break-words text-xs text-sky">Your mailbox · {currentHistory.mailbox}{currentHistory.matchedEmail ? ` · Contact ${currentHistory.matchedEmail}` : ''}</p>}
        {currentHistory.limited && <p className="mb-3 text-xs text-muted">{currentHistory.searchScope || 'Showing the latest 12 saved messages. Older messages may not appear here.'}</p>}
        {!currentHistory.contactRequired && <p className="mb-2 text-xs text-muted">{Math.min(currentHistory.messages.length, LEAD_EMAIL_MESSAGE_LIMIT)} messages shown · Newest first</p>}
        {!currentHistory.messages.length && !currentHistory.contactRequired && <p className="py-3 text-sm text-muted">{source === 'mailbox' ? 'No matching messages were returned in this limited lookup. That does not prove there has been no contact. Check your mailbox directly for older correspondence or other contact addresses.' : 'No saved email messages are available for this company in your account. Check your connected mailbox for correspondence that has not been recorded in LiveCoach.'}</p>}
        <div className="max-h-[32rem] space-y-3 overflow-y-auto overscroll-contain pr-1" tabIndex={currentHistory.messages.length ? 0 : undefined} aria-label="Email messages">
          {currentHistory.messages.slice(0, LEAD_EMAIL_MESSAGE_LIMIT).map(message => <article key={message.id} className="rounded-lg border border-edge bg-panel p-3">
            <p className="text-xs text-muted">{message.direction === 'sent' ? 'Sent' : 'Received'} · {recordedEmailDate(message.at)} · {message.source}</p>
            <h4 className="mt-1 break-words text-sm font-semibold">{message.subject}</h4>
            {message.correspondent && <p className="mt-1 break-all text-xs text-muted">{message.direction === 'sent' ? 'To' : 'From'} {message.correspondent}</p>}
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-bone/85">{message.text || (message.source === 'Connected mailbox' ? 'No plain-text content was returned for this message.' : 'The message text was not saved in this record.')}</p>
            {message.textUnavailable ? <p className="mt-2 text-xs text-amber">The message body could not be loaded. Only its preview is shown. Refresh latest emails to try this read again.</p> : (message.truncated || (message.source !== 'Connected mailbox' && message.direction === 'received')) && <p className="mt-2 text-xs text-muted">{message.source === 'Connected mailbox' ? 'Long message shortened for display. Open your mailbox for the full text.' : 'Saved excerpt, not the full mailbox conversation.'}</p>}
          </article>)}
        </div>
      </>}
    </div>}
  </section>;
}
