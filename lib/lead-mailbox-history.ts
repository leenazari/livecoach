import 'server-only';
import { salesLeadScope } from '@/lib/sales-lead-service';
import { loadLeadEmailContacts } from '@/lib/lead-email-contacts';
import { loadOwnAccountEmails } from '@/lib/own-account-emails';
import { connectedMailProvider } from '@/lib/mail';
import { recentMessages as googleMessages, freshMessageText as googleText } from '@/lib/gmail';
import { recentMicrosoftMessages, freshMicrosoftMessageText } from '@/lib/microsoft';
import { LEAD_EMAIL_MESSAGE_LIMIT, type RecordedCompanyEmail, type RecordedCompanyEmailHistory } from '@/lib/recorded-company-emails';

const addresses = (value: string) => (value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(email => email.toLowerCase());

// A deliberate read of the CURRENT actor's connected mailbox. Never look up the
// assignee's credentials, and never turn an arbitrary browser-supplied address
// or fuzzy company/name match into a mailbox query. Nothing is persisted here.
export async function loadLeadMailboxHistory(companyId: string, contactId = ''): Promise<RecordedCompanyEmailHistory> {
  const scope = await salesLeadScope();
  const candidates = await loadLeadEmailContacts(companyId);
  const ownEmails = await loadOwnAccountEmails(scope.userId);
  const connection = await connectedMailProvider(scope.userId);
  if (!connection.provider || !connection.email) throw new Error('mailbox_not_connected');
  ownEmails.add(connection.email.toLowerCase());
  const contacts = candidates.filter(contact => !ownEmails.has(contact.email));
  if (!contacts.length) throw new Error('mailbox_contact_missing');
  const selected = contactId ? contacts.find(contact => contact.id === contactId) : contacts.length === 1 ? contacts[0] : null;
  if (contactId && !selected) throw new Error('mailbox_contact_unavailable');
  if (!selected) return { messages: [], limited: false, contacts, contactRequired: true, mailbox: connection.email };
  const target = selected.email;
  const query = `(from:${target} OR to:${target}) -in:drafts`;
  const options = { strict: true, signal: AbortSignal.timeout(15000) };
  const source = await (connection.provider === 'google'
    ? googleMessages(query, LEAD_EMAIL_MESSAGE_LIMIT, scope.userId, options)
    : recentMicrosoftMessages(query, LEAD_EMAIL_MESSAGE_LIMIT, scope.userId, { ...options, exactContactEmail: target }))
    .catch(() => { throw new Error('mailbox_search_unavailable'); });
  const messages: RecordedCompanyEmail[] = [];
  for (const message of source) {
    if (message.labelIds?.includes('DRAFT')) continue;
    const from = addresses(message.from), recipients = addresses(`${message.to} ${message.cc}`);
    const received = from.includes(target);
    const sent = !received && recipients.includes(target) && (from.some(email => ownEmails.has(email)) || message.labelIds?.includes('SENT'));
    if (!received && !sent) continue; // Recheck provider search results exactly.
    const at = Date.parse(message.date);
    if (!Number.isFinite(at)) continue;
    if (messages.some(item => item.id === `mailbox-${connection.provider}-${message.id}`)) continue;
    messages.push({ id: `mailbox-${connection.provider}-${message.id}`, companyId, direction: received ? 'received' : 'sent', at: new Date(at).toISOString(), subject: message.subject.slice(0, 500) || 'No subject', correspondent: target, source: 'Connected mailbox', text: message.snippet.slice(0, 8000), truncated: true, threadId: message.threadId });
  }
  messages.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const latest = messages.slice(0, LEAD_EMAIL_MESSAGE_LIMIT);
  // Fetch only the selected 12 bodies, in parallel and under the same deadline.
  // Never write or send these emails to an AI model. Failed bodies keep a
  // clearly labelled preview instead of pretending it is the complete message.
  await Promise.all(latest.map(async message => {
    const sourceMessage = source.find(item => message.id === `mailbox-${connection.provider}-${item.id}`)!;
    try {
      const body = await (connection.provider === 'google' ? googleText : freshMicrosoftMessageText)(sourceMessage.id, 8000, scope.userId, options);
      message.text = body;
      message.truncated = body.endsWith('…');
    } catch {
      message.textUnavailable = true;
    }
  }));
  return { messages: latest, limited: true, contacts, selectedContactId: selected.id, mailbox: connection.email, matchedEmail: target, searchScope: 'Sent and received messages with this contact, across email subjects. Quoted older replies are removed.' };
}
