'use client';
import { useState } from 'react';
import { crmFetch, type Contact } from '@/lib/crm';
export default function ContactEmails({ contact, onSaved }: { contact: Contact; onSaved: (contact: Contact) => void }) {
  const [primary, setPrimary] = useState(contact.email || '');
  const [additional, setAdditional] = useState(Array.isArray(contact.attributes?.emails) ? contact.attributes.emails.filter((e: string) => e !== contact.email).join('\n') : '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <details className="mt-2 text-xs"><summary className="cursor-pointer text-amber">Email addresses</summary>
    <form className="mt-2 grid gap-2" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try {
        const emails = [...new Set([primary, ...additional.split(/[\n,;]+/)].map(e => e.trim().toLowerCase()).filter(Boolean))];
        if (emails.length > 10 || emails.some(e => e.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(e))) throw new Error('Enter up to ten valid email addresses.');
        const data = await crmFetch<{ contact: Contact }>(`/api/crm/contacts/${contact.id}`, { method: 'PATCH', body: JSON.stringify({ email: primary.trim().toLowerCase(), attributes: { emails } }) });
        onSaved(data.contact);
      } catch (e) { setError((e as Error).message || 'Check the saved contact before retrying.'); } finally { setBusy(false); }
    }}>
      <label>Primary email<input aria-label="Primary contact email" className="mt-1 w-full rounded border border-edge bg-panel p-2" type="email" value={primary} onChange={e => setPrimary(e.target.value)} /></label>
      <label>Additional emails, one per line<textarea aria-label="Additional contact emails" className="mt-1 w-full rounded border border-edge bg-panel p-2" rows={2} value={additional} onChange={e => setAdditional(e.target.value)} /></label>
      <p className="text-muted">Work, personal and previous addresses stay on this person. The contact owner manages these addresses.</p>
      {error && <p role="alert" className="text-rust">{error}</p>}<button disabled={busy} className="justify-self-start rounded border border-edge px-3 py-2">{busy ? 'Saving…' : 'Save email addresses'}</button>
    </form></details>;
}
