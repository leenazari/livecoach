import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { INBOUND_SOURCES, INBOUND_STATES } from '@/lib/inbound-leads';
import { INBOUND_FIELDS, inboundFailure, inboundResponse, inboundSales, requireInboundReviewer, InboundError } from '@/lib/inbound-leads-server';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const { scope, settings } = await requireInboundReviewer();
    const params = req.nextUrl.searchParams; const page = Number(params.get('page') || 1); const status = params.get('status') || ''; const source = params.get('source') || ''; const search = (params.get('search') || '').trim();
    if (!Number.isInteger(page) || page < 1 || page > 10000 || search.length > 160 || (status && !(INBOUND_STATES as readonly string[]).includes(status)) || (source && !(INBOUND_SOURCES as readonly string[]).includes(source))) throw new InboundError(400, 'Choose valid filters');
    const pageSize = 25;
    let query = supabaseAdmin.from('inbound_leads').select(INBOUND_FIELDS, { count: 'exact' }).eq('workspace_id', scope.workspaceId);
    if (status) query = query.eq('status', status); if (source) query = query.eq('source', source);
    if (search) query = query.ilike('company_name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const [rows, counts, sales] = await Promise.all([
      query.order('created_at', { ascending: false }).order('id').range((page - 1) * pageSize, page * pageSize - 1),
      Promise.all(INBOUND_STATES.map(async state => { const result = await supabaseAdmin.from('inbound_leads').select('id', { count: 'exact', head: true }).eq('workspace_id', scope.workspaceId).eq('status', state); if (result.error) throw result.error; return [state, result.count || 0] as const; })),
      inboundSales(scope.workspaceId, settings?.sales_user_ids || []),
    ]);
    if (rows.error) throw rows.error;
    return inboundResponse({ leads: rows.data || [], total: rows.count || 0, page, pageSize, counts: Object.fromEntries(counts), sales });
  } catch (error) { return inboundFailure(error); }
}
