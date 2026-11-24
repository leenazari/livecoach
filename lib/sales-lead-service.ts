import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { requireRequestScope } from '@/lib/request-scope';
import { crmBlockerPayload } from '@/lib/crm-blocker';
import { NextResponse } from 'next/server';
export const salesLeadHeaders = { 'Cache-Control': 'private, no-store' };
export async function salesLeadScope() {
  const scope = requireRequestScope();
  const { data, error } = await supabaseService.from('workspace_members').select('role,status').eq('workspace_id', scope.workspaceId).eq('user_id', scope.userId).maybeSingle();
  if (error) throw error;
  if (data?.status !== 'active' || !['owner', 'manager', 'sales'].includes(data.role)) throw new Error('sales_lead_access');
  return { ...scope, role: data.role as 'owner' | 'manager' | 'sales' };
}
export function salesLeadFailure(error: unknown, action: string) {
  const code = String((error as any)?.message || '');
  const denied = /sales_lead_access|verified workspace/.test(code);
  const conflict = /sales_lead_.*(conflict|review|protected)/.test(code);
  console.error('sales_lead_failed', { action, code: denied ? 'access_denied' : conflict ? 'review_required' : (error as any)?.code || 'unconfirmed' });
  return NextResponse.json(crmBlockerPayload({ code: denied ? 'sales_lead_access_denied' : conflict ? 'sales_lead_review_required' : 'sales_lead_not_confirmed', title: `${action} could not be confirmed`, reason: denied ? 'Your account does not have active access to this assigned lead' : conflict ? 'The company, contact or opportunity has conflicting ownership or source details' : 'LiveCoach could not confirm the result', nextAction: denied ? 'Ask Lee to check your membership and assignment' : 'Check the company and pipeline before trying again. Keep the same source reference', responsible: denied || conflict ? 'owner' : 'system' }), { status: denied ? 403 : conflict ? 409 : 503, headers: salesLeadHeaders });
}
