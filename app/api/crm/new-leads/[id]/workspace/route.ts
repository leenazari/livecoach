import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { AssignedLeadAccessError, loadAssignedNewLeads } from '@/lib/assigned-new-leads-server';
import { salesLeadHeaders, salesLeadScope } from '@/lib/sales-lead-service';
import { loadVisibleOpportunityById } from '@/lib/opportunity-access';
import { crmBlockerPayload } from '@/lib/crm-blocker';
import type { LeadWorkspace } from '@/lib/lead-workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';

// One selected lead only. Never preload every lead's private history, ask an
// LLM, or turn a workspace owner's view into access to a rep's private tasks.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!uuid.test(params.id)) return NextResponse.json(crmBlockerPayload({ code: 'lead_workspace_invalid', title: 'Choose a lead from your list', reason: 'The lead reference is not valid', nextAction: 'Return to New leads and open the company again' }), { status: 400, headers: salesLeadHeaders });
    const scope = await salesLeadScope();
    const assigned = await loadAssignedNewLeads(params.id);
    const lead = assigned.leads.find(row => row.id === params.id);
    if (!lead) throw new AssignedLeadAccessError('Lead unavailable');
    const signal = AbortSignal.timeout(8000);
    const [notes, tasks, opportunity] = await Promise.all([
      supabaseAdmin.from('client_context').select('id,company_id,workspace_id,owner_id,title,content,created_at')
        .eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).eq('company_id', lead.id).eq('kind', 'note')
        .order('created_at', { ascending: false }).limit(13).abortSignal(signal),
      supabaseAdmin.from('tasks').select('id,company_id,workspace_id,owner_id,text,due_at')
        .eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).eq('company_id', lead.id).eq('status', 'open').is('done_at', null)
        .order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(9).abortSignal(signal),
      lead.opportunityId ? loadVisibleOpportunityById(scope, lead.opportunityId,
        'id,company_id,workspace_id,owner_id,assigned_to_user_id,visibility,opportunity_type,title,pipeline_stage,next_action,next_action_due_at') : null,
    ]);
    if (notes.error) throw notes.error;
    if (tasks.error) throw tasks.error;
    const own = (row: any) => row.workspace_id === scope.workspaceId && row.owner_id === scope.userId && row.company_id === lead.id;
    const deal = opportunity?.company_id === lead.id && opportunity.workspace_id === scope.workspaceId ? opportunity : null;
    const result: LeadWorkspace = {
      lead,
      notes: (notes.data || []).filter(own).slice(0, 12).map(row => ({ id: row.id, title: text(row.title, 120) || 'Note', content: text(row.content, 4000), createdAt: row.created_at })),
      tasks: (tasks.data || []).filter(own).slice(0, 8).map(row => ({ id: row.id, text: text(row.text), dueAt: row.due_at })),
      opportunity: deal ? { id: deal.id, title: text(deal.title), stage: text(deal.pipeline_stage, 80), nextAction: text(deal.next_action, 1000), dueAt: deal.next_action_due_at || null } : null,
      limited: { notes: (notes.data?.length || 0) > 12, tasks: (tasks.data?.length || 0) > 8 },
    };
    return NextResponse.json(result, { headers: salesLeadHeaders });
  } catch (error) {
    const denied = error instanceof AssignedLeadAccessError || /sales_lead_access|verified workspace/.test(String((error as Error)?.message));
    console.error('lead_workspace_read_failed', { code: denied ? 'access_denied' : 'read_failed' });
    return NextResponse.json(crmBlockerPayload({ code: denied ? 'lead_workspace_access_denied' : 'lead_workspace_read_failed', title: 'Lead workspace could not be opened', reason: denied ? 'This lead is no longer available to your active account' : 'The saved activity or tasks could not be loaded', nextAction: denied ? 'Return to your list and ask Lee to check the assignment' : 'Try loading the workspace again. No records have been changed', responsible: denied ? 'owner' : 'system' }), { status: denied ? 403 : 503, headers: salesLeadHeaders });
  }
}
