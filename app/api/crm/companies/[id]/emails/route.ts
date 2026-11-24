import { NextResponse } from 'next/server';
import { salesLeadScope } from '@/lib/sales-lead-service';
import { loadAssignedClientAccess } from '@/lib/assigned-client-access';
import { loadRecordedCompanyEmails } from '@/lib/recorded-company-emails-server';
import { loadLeadMailboxHistory } from '@/lib/lead-mailbox-history';
import { crmBlockerPayload } from '@/lib/crm-blocker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const scope = await salesLeadScope();
    const source = new URL(request.url).searchParams.get('source') || 'saved';
    if (!['saved', 'mailbox'].includes(source)) {
      return NextResponse.json(crmBlockerPayload({ code: 'email_history_invalid_source', title: 'Email history could not be opened', reason: 'This email source is not supported', nextAction: 'Open email history from the lead list' }), { status: 400, headers });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.id)) {
      return NextResponse.json(crmBlockerPayload({ code: 'email_history_invalid_company', title: 'Email history could not be opened', reason: 'This company link is not valid', nextAction: 'Open the company from your lead list' }), { status: 400, headers });
    }
    if (!(await loadAssignedClientAccess(params.id, scope))) throw new Error('sales_lead_access');
    return NextResponse.json(source === 'mailbox' ? await loadLeadMailboxHistory(params.id) : await loadRecordedCompanyEmails([params.id], true), { headers });
  } catch (error) {
    const code = String((error as Error)?.message);
    const denied = /sales_lead_access|verified workspace/.test(String((error as Error)?.message));
    if (['mailbox_contact_missing', 'mailbox_not_connected', 'mailbox_search_unavailable'].includes(code)) {
      return NextResponse.json(crmBlockerPayload({ code, title: 'Your mailbox could not be checked', reason: code === 'mailbox_contact_missing' ? 'This lead needs a valid contact email that is different from your own mailbox' : code === 'mailbox_not_connected' ? 'Your account does not have a connected email mailbox' : 'Your email provider did not return a complete search result', nextAction: code === 'mailbox_contact_missing' ? 'Check the contact email on the company record' : 'Check your email connection in Settings, then try this read again. No messages have been sent or changed' }), { status: code === 'mailbox_search_unavailable' ? 503 : 409, headers });
    }
    console.error('recorded_email_history_failed', { code: denied ? 'access_denied' : 'read_failed' });
    return NextResponse.json(crmBlockerPayload({ code: denied ? 'email_history_access_denied' : 'email_history_unavailable', title: 'Email history could not be opened', reason: denied ? 'Your account no longer has active access to this company' : 'One of the saved email sources could not be read', nextAction: denied ? 'Ask your workspace owner to check your membership and company assignment' : 'Try loading the history again. No messages have been sent or changed' }), { status: denied ? 403 : 503, headers });
  }
}
