import 'server-only';
import { salesLeadScope } from '@/lib/sales-lead-service';
import { loadAssignedNewLeads } from '@/lib/assigned-new-leads-server';
import { connectedMailProvider } from '@/lib/mail';
import { recentMessages as googleMessages } from '@/lib/gmail';
import { recentMicrosoftMessages } from '@/lib/microsoft';
import type { RecordedCompanyEmail, RecordedCompanyEmailHistory } from '@/lib/recorded-company-emails';

const addresses = (value: string) => (value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(email => email.toLowerCase());

// A deliberate read of the CURRENT actor's connected mailbox. Never look up the
// assignee's credentials, and never turn an arbitrary browser-supplied address
// or fuzzy company/name match into a mailbox query. Nothing is persisted here.
export async function loadLeadMailboxHistory(companyId: string): Promise<RecordedCompanyEmailHistory> {
  const scope = await salesLeadScope();
  const assigned = await loadAssignedNewLeads(companyId);
  const lead = assigned.leads.find(item => item.id === companyId);
  if (!lead) throw new Error('sales_lead_access');
  const target = lead.email.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(target)) throw new Error('mailbox_contact_missing');
  const connection = await connectedMailProvider(scope.userId);
  if (!connection.provider || !connection.email) throw new Error('mailbox_not_connected');
  // Do not search the user's own address, which would match most of their inbox.
  if (target === connection.email.toLowerCase()) throw new Error('mailbox_contact_missing');
  const query = `(from:${target} OR to:${target})`;
  const options = { strict: true, signal: AbortSignal.timeout(15000) };
  const source = await (connection.provider === 'google'
    ? googleMessages(query, 12, scope.userId, options)
    : recentMicrosoftMessages(query, 12, scope.userId, { ...options, exactContactEmail: target }))
    .catch(() => { throw new Error('mailbox_search_unavailable'); });
  const messages: RecordedCompanyEmail[] = [];
  for (const message of source) {
    if (message.labelIds?.includes('DRAFT')) continue;
    const from = addresses(message.from), recipients = addresses(`${message.to} ${message.cc}`);
    const received = from.includes(target);
    const sent = !received && recipients.includes(target) && (from.includes(connection.email.toLowerCase()) || message.labelIds?.includes('SENT'));
    if (!received && !sent) continue; // Recheck provider search results exactly.
    const at = Date.parse(message.date);
    if (!Number.isFinite(at)) continue;
    messages.push({ id: `mailbox-${connection.provider}-${message.id}`, companyId, direction: received ? 'received' : 'sent', at: new Date(at).toISOString(), subject: message.subject.slice(0, 500) || 'No subject', correspondent: target, source: 'Connected mailbox', text: message.snippet.slice(0, 8000), truncated: true });
  }
  messages.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { messages, limited: true, mailbox: connection.email, matchedEmail: target, searchScope: 'Up to 12 recent messages matching this exact contact. Message previews are shown, not full threads.' };
}
