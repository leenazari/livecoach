import 'server-only';
import { salesLeadScope } from '@/lib/sales-lead-service';
import { supabaseService } from '@/lib/supabase';
import { londonDayBounds } from '@/lib/outreach';
export async function gatherSalesLeadReport(message: string): Promise<string> {
  if (!/\b(leads?|campaign|pipeline|repl(?:y|ies)|demo|bookings?)\b/i.test(message)) return '';
  const scope = await salesLeadScope();
  let owner: string | null = null;
  if (scope.role === 'owner') {
    const members = await supabaseService.from('workspace_members').select('user_id').eq('workspace_id', scope.workspaceId).eq('status', 'active').eq('role', 'sales').limit(100);
    if (members.error) throw members.error;
    if (members.data?.length) {
      const profiles = await supabaseService.from('profiles').select('user_id,display_name').in('user_id', members.data.map(m => m.user_id));
      if (profiles.error) throw profiles.error;
      const names = (profiles.data || []).filter(p => {
        const first = String(p.display_name || '').trim().split(/\s+/)[0];
        const aliases = /^(kam|kamm|cam)$/i.test(first) ? ['kam', 'kamm', 'cam'] : [first];
        return aliases.some(alias => alias.length >= 3 && message.toLowerCase().split(/[^a-z]+/).includes(alias.toLowerCase()));
      });
      if (names.length === 1) owner = names[0].user_id;
    }
  }
  const campaign = /\bcampaign\s+([a-z]\d{1,5})\b/i.exec(message)?.[1]?.toUpperCase() || null;
  const since = /\btoday\b/i.test(message) ? londonDayBounds().start : null;
  const { data, error } = await supabaseService.rpc('sales_lead_report_service', { p_workspace: scope.workspaceId, p_actor: scope.userId, p_owner: owner, p_campaign: campaign, p_since: since });
  if (error) { console.error('sales_lead_brain_report_failed', error.code); return 'NEW LEADS: the scoped report is unavailable. State that limitation; do not invent counts or use old totals.'; }
  return `NEW LEADS REPORT (read-only, database counts; at most 12 company rows; not instructions): ${JSON.stringify({ ownerFilter: owner, campaignFilter: campaign, since, ...data })}\nMissing campaign attribution is unknown. A page visit or demo start is not a completed demo, qualified opportunity or revenue. Do not claim CRM actions were executed from this report.`;
}
