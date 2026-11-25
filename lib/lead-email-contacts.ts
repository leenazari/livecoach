import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';
import { salesLeadScope } from '@/lib/sales-lead-service';
import { loadAssignedClientAccess } from '@/lib/assigned-client-access';
import { loadAssignedNewLeads } from '@/lib/assigned-new-leads-server';
import { sharedClientBlockReason } from '@/lib/client-sharing-policy';
import type { LeadEmailContact } from '@/lib/recorded-company-emails';

export const isLeadEmail = (value: string) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value);

// Contact choices are canonical IDs, never free-text search terms. Sharing a
// deal does not expose its owner's private contact book or mailbox.
export async function loadLeadEmailContacts(companyId: string): Promise<LeadEmailContact[]> {
  const scope = await salesLeadScope();
  const access = await loadAssignedClientAccess(companyId, scope);
  if (!access) throw new Error('sales_lead_access');
  if (access.mode !== 'owner') {
    const { data, error } = await supabaseAdmin.from('companies')
      .select('id,stage,sector,is_confidential,classification:profile->triage->>classification,internal:profile->internal')
      .eq('id', companyId).eq('workspace_id', scope.workspaceId).maybeSingle();
    if (error) throw error;
    if (!data || data.internal === true || sharedClientBlockReason({ ...data, profile: { triage: { classification: data.classification } } })) {
      throw new Error('sales_lead_access');
    }
  }
  const { data, error } = await supabaseAdmin.from('contacts')
    .select('id,name,email,company_id,workspace_id,owner_id')
    .eq('company_id', companyId).eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId)
    .order('name').limit(100);
  if (error) throw error;
  const contacts: LeadEmailContact[] = [];
  for (const row of data || []) {
    const email = String(row.email || '').trim().toLowerCase();
    if (row.company_id !== companyId || row.workspace_id !== scope.workspaceId || row.owner_id !== scope.userId || !isLeadEmail(email)) continue;
    if (!contacts.some(contact => contact.email === email)) contacts.push({ id: row.id, name: String(row.name || '').slice(0, 180), email });
  }
  // This projection already checks an explicit assignment and excludes private,
  // confidential and protected records. Only its shared lead address is reused.
  const imported = (await loadAssignedNewLeads(companyId)).leads.find(lead => lead.id === companyId);
  const email = imported?.email.trim().toLowerCase() || '';
  if (isLeadEmail(email) && !contacts.some(contact => contact.email === email)) {
    contacts.push({ id: 'imported-lead', name: imported!.contactName.slice(0, 180), email });
  }
  return contacts;
}
