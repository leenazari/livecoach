import { NextRequest } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { inboundConfiguration } from '@/lib/inbound-leads';
import { adminCommand, inboundFailure, inboundResponse, readInboundBody, requireInboundOwner } from '@/lib/inbound-leads-server';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET() {
  try { const { scope, settings } = await requireInboundOwner();
    const members = await supabaseService.from('workspace_members').select('user_id,department,role').eq('workspace_id', scope.workspaceId).eq('status', 'active'); if (members.error) throw members.error;
    const ids = (members.data || []).map(m => m.user_id); const profiles = ids.length ? await supabaseService.from('profiles').select('user_id,display_name').in('user_id', ids) : { data: [], error: null }; if (profiles.error) throw profiles.error;
    const directory = (members.data || []).map(m => ({ userId: m.user_id, name: String(profiles.data?.find(p => p.user_id === m.user_id)?.display_name || 'Team member'), department: m.department, role: m.role }));
    const keys = await supabaseService.from('inbound_lead_keys').select('id,label,token_prefix,scopes,sources,event_types,enabled,expires_at,created_at').eq('workspace_id', scope.workspaceId).order('created_at', { ascending: false }).limit(50); if (keys.error) throw keys.error;
    return inboundResponse({ settings: { enabled: settings?.enabled || false, reviewerId: settings?.reviewer_user_id || null, salesIds: settings?.sales_user_ids || [] }, reviewers: directory.filter(m => m.department === 'marketing'), sales: directory.filter(m => m.department === 'sales' && m.role === 'sales'), keys: keys.data || [] });
  } catch (error) { return inboundFailure(error); }
}
export async function POST(req: NextRequest) { try { const body = inboundConfiguration.parse(await readInboundBody(req)); return inboundResponse(await adminCommand('configure', body)); } catch (error) { return inboundFailure(error); } }
