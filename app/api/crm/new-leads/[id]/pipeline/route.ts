import { NextRequest, NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { loadAssignedNewLeads } from '@/lib/assigned-new-leads-server';
import { salesLeadFailure, salesLeadHeaders, salesLeadScope } from '@/lib/sales-lead-service';
import { crmBlockerPayload } from '@/lib/crm-blocker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const scope = await salesLeadScope();
    const body = await req.json().catch(() => null);
    if (!/^[0-9a-f-]{36}$/i.test(params.id) || body?.confirmed !== true) return NextResponse.json(crmBlockerPayload({ code: 'sales_lead_confirmation_required', title: 'Confirm the sales opportunity', reason: 'A salesperson must confirm that this lead belongs in the pipeline', nextAction: 'Choose Add to pipeline on the exact lead' }), { status: 400, headers: salesLeadHeaders });
    const result = await loadAssignedNewLeads(params.id);
    if (!result.leads.length) throw new Error('sales_lead_access');
    const lead = result.leads[0];
    const { data: company, error: companyError } = await supabaseService.from('companies').select('source_ref:attributes->importedLead->>sourceRef').eq('workspace_id', scope.workspaceId).eq('id', lead.id).maybeSingle();
    if (companyError) throw companyError;
    const ref = `sales_confirmed:${lead.id}`;
    const prior = await supabaseService.from('sales_lead_event_receipts').select('occurred_at').eq('workspace_id', scope.workspaceId).eq('event_ref', ref).maybeSingle();
    if (prior.error) throw prior.error;
    const { data, error } = await supabaseService.rpc('record_sales_lead_event_service', { p_workspace: scope.workspaceId, p_actor: scope.userId, p_company: lead.id, p_event: { type: 'sales_confirmed', ref, sourceRef: company?.source_ref, occurredAt: prior.data?.occurred_at || new Date().toISOString() } });
    if (error) throw error;
    return NextResponse.json(data, { headers: salesLeadHeaders });
  } catch (error) { return salesLeadFailure(error, 'Adding the lead to pipeline'); }
}
