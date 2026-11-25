import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';
import { salesLeadScope } from '@/lib/sales-lead-service';
import { LEAD_EMAIL_MESSAGE_LIMIT, type RecordedCompanyEmail, type RecordedCompanyEmailHistory } from '@/lib/recorded-company-emails';

type BaseRow = { id: string; workspace_id: string };
type OutreachRow = BaseRow & { sender_user_id: string; status: string; subject: string; recipient_email: string; sent_at: string; gmail_message_id: string | null; body_text?: string; outreach_prospects: { crm_company_id: string; workspace_id: string } };
type AssistantRow = BaseRow & { owner_id: string; company_id: string; status: string; draft_subject: string; recipient_email: string; sent_at: string; provider_message_id: string | null; draft_body?: string };
type ReplyRow = BaseRow & { owner_id: string; company_id: string; kind: string; title: string; created_at: string; source_ref: string | null; metadata: Record<string, unknown> | null; content?: string };
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const timestamp = (value: unknown) => {
  const date = Date.parse(text(value));
  return Number.isFinite(date) ? new Date(date).toISOString() : '';
};

// Callers supply only already-authorised company IDs. The list route passes its
// current page, and the detail route checks company access first. Team access
// never expands mailbox access, even for a workspace owner viewing another rep.
export async function loadRecordedCompanyEmails(companyIds: string[], includeText = false): Promise<RecordedCompanyEmailHistory> {
  const scope = await salesLeadScope(); // Recheck active membership, not just a JWT role.
  const ids = [...new Set(companyIds)];
  if (!ids.length) return { messages: [], limited: false };
  if (ids.length > 25) throw new Error('email_history_page_too_large');
  const limit = includeText ? LEAD_EMAIL_MESSAGE_LIMIT + 1 : 100;
  const signal = AbortSignal.timeout(includeText ? 10000 : 2000);
  const body = includeText ? ',body_text' : '';
  const results = await Promise.all([
    supabaseAdmin.from('outreach_messages')
      .select(`id,workspace_id,sender_user_id,status,subject,recipient_email,sent_at,gmail_message_id,outreach_prospects!inner(crm_company_id,workspace_id)${body}`)
      .eq('workspace_id', scope.workspaceId).eq('sender_user_id', scope.userId).eq('status', 'sent')
      .eq('outreach_prospects.workspace_id', scope.workspaceId).in('outreach_prospects.crm_company_id', ids)
      .not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(limit).abortSignal(signal).returns<OutreachRow[]>(),
    supabaseAdmin.from('email_assistant_drafts')
      .select(`id,company_id,workspace_id,owner_id,status,draft_subject,recipient_email,sent_at,provider_message_id${includeText ? ',draft_body' : ''}`)
      .eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).in('company_id', ids).eq('status', 'sent')
      .not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(limit).abortSignal(signal).returns<AssistantRow[]>(),
    supabaseAdmin.from('client_context')
      .select(`id,company_id,workspace_id,owner_id,kind,title,created_at,source_ref,metadata${includeText ? ',content' : ''}`)
      .eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).in('company_id', ids).eq('kind', 'email_reply')
      .order('created_at', { ascending: false }).limit(limit).abortSignal(signal).returns<ReplyRow[]>(),
  ]);
  // A failed source is unavailable, not evidence of no contact. Do not return a
  // misleading partial history as though it were complete.
  for (const result of results) if (result.error) throw result.error;
  const messages: RecordedCompanyEmail[] = [];
  const seen = new Set<string>();
  function add(row: BaseRow, item: RecordedCompanyEmail, rawText: unknown, key: string) {
    const companyKey = `${item.companyId}:${key}`;
    if (row.workspace_id !== scope.workspaceId || !ids.includes(item.companyId) || !item.at || seen.has(companyKey)) return;
    seen.add(companyKey);
    messages.push({ ...item, ...(includeText ? { text: text(rawText, 8000), truncated: typeof rawText === 'string' && rawText.length > 8000 } : {}) });
  }
  for (const row of results[0].data || []) {
    const prospect = Array.isArray(row.outreach_prospects) ? row.outreach_prospects[0] : row.outreach_prospects;
    if (row.sender_user_id !== scope.userId || row.status !== 'sent' || prospect?.workspace_id !== scope.workspaceId) continue;
    add(row, { id: `outreach-${row.id}`, companyId: prospect.crm_company_id, direction: 'sent', at: timestamp(row.sent_at), subject: text(row.subject) || 'No subject', correspondent: text(row.recipient_email), source: 'Outreach' }, row.body_text, row.gmail_message_id ? `sent-${row.gmail_message_id}` : `outreach-${row.id}`);
  }
  for (const row of results[1].data || []) {
    if (row.owner_id !== scope.userId || row.status !== 'sent') continue;
    add(row, { id: `assistant-${row.id}`, companyId: row.company_id, direction: 'sent', at: timestamp(row.sent_at), subject: text(row.draft_subject) || 'No subject', correspondent: text(row.recipient_email), source: 'Email assistant' }, row.draft_body, row.provider_message_id ? `sent-${row.provider_message_id}` : `assistant-${row.id}`);
  }
  for (const row of results[2].data || []) {
    if (row.owner_id !== scope.userId || row.kind !== 'email_reply') continue;
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
    add(row, { id: `reply-${row.id}`, companyId: row.company_id, direction: 'received', at: timestamp(metadata.receivedAt) || timestamp(row.created_at), subject: text(metadata.subject) || text(row.title) || 'No subject', correspondent: text(metadata.senderEmail) || text(metadata.senderName), source: 'Recorded reply' }, row.content, row.source_ref ? `reply-${row.source_ref}` : `reply-${row.id}`);
  }
  messages.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { messages: includeText ? messages.slice(0, LEAD_EMAIL_MESSAGE_LIMIT) : messages, limited: (includeText && messages.length > LEAD_EMAIL_MESSAGE_LIMIT) || results.some(result => (result.data?.length || 0) >= limit) };
}
