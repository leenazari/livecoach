import { NextRequest, NextResponse } from 'next/server';
import { crmBlockerPayload } from '@/lib/crm-blocker';
import { LEAD_STATUSES } from '@/lib/assigned-new-leads';
import { AssignedLeadAccessError, loadAssignedNewLeads } from '@/lib/assigned-new-leads-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const page = Number(p.get('page') || 1), companyId = p.get('companyId') || '', owner = p.get('owner') || '', status = p.get('status') || '', search = (p.get('search') || '').trim().toLowerCase();
    if (!Number.isInteger(page) || page < 1 || page > 10000 || search.length > 160 ||
      (companyId && !uuid.test(companyId)) || (owner && !uuid.test(owner)) ||
      (status && !(LEAD_STATUSES as readonly string[]).includes(status))) {
      return NextResponse.json(crmBlockerPayload({ code: 'new_lead_filters_invalid', title: 'Lead filters need checking', reason: 'One of the supplied filters is not valid', nextAction: 'Clear the filters and choose them again' }), { status: 400, headers });
    }
    const result = await loadAssignedNewLeads(companyId || undefined);
    if (owner && !result.isOwner) throw new AssignedLeadAccessError('Only the owner may filter other accounts');
    const filtered = result.leads.filter(l => (!owner || l.assignedTo === owner) && (!status || l.status === status) &&
      (!search || [l.companyName, l.contactName, l.email].join(' ').toLowerCase().includes(search)));
    const pageSize = 25;
    return NextResponse.json({ ...result, leads: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, allCount: result.leads.length, page, pageSize }, { headers });
  } catch (error) {
    const denied = error instanceof AssignedLeadAccessError;
    console.error('New lead list failed', denied ? 'access_denied' : (error as { code?: string })?.code || 'read_failed');
    return NextResponse.json(crmBlockerPayload({ code: denied ? 'new_leads_access_denied' : 'new_leads_read_failed', title: 'New leads could not be opened', reason: denied ? 'Your account does not have active access to this assigned lead view' : 'The CRM could not load your assigned leads', nextAction: denied ? 'Ask Lee to check your membership and lead assignment' : 'Refresh the list. Your records have not been changed', responsible: denied ? 'owner' : 'system' }), { status: denied ? 403 : 503, headers });
  }
}
