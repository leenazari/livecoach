import 'server-only';
import { supabaseService } from '@/lib/supabase';
import { requireRequestScope } from '@/lib/request-scope';
import { sharedClientBlockReason } from '@/lib/client-sharing-policy';
import { compareLeadAdded, projectAssignedLead, type AssignedLead } from '@/lib/assigned-new-leads';

export class AssignedLeadAccessError extends Error {}
export async function loadAssignedNewLeads(companyId?: string) {
  const scope = requireRequestScope();
  const { data: member, error: memberError } = await supabaseService.from('workspace_members')
    .select('role,status').eq('workspace_id', scope.workspaceId).eq('user_id', scope.userId).maybeSingle();
  if (memberError) throw memberError;
  if (!member || member.status !== 'active' || !['owner', 'manager', 'sales'].includes(member.role)) throw new AssignedLeadAccessError('Active membership required');
  const viewer = { ...scope, role: member.role };
  const isOwner = member.role === 'owner';
  const assignments: any[] = [];
  // No workspace-wide sales cover here. The assignment, not the record's privacy owner,
  // determines whose queue it is. Managers also see only their own assigned work.
  for (let offset = 0; ; offset += 1000) {
    let q = supabaseService.from('team_client_shares')
      .select('company_id,workspace_id,status,assigned_to_user_id')
      .eq('workspace_id', scope.workspaceId).eq('status', 'active').order('company_id');
    if (!isOwner) q = q.eq('assigned_to_user_id', scope.userId);
    if (companyId) q = q.eq('company_id', companyId);
    const { data, error } = await q.range(offset, offset + 999);
    if (error) throw error;
    assignments.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const assignmentByCompany = new Map(assignments.map(a => [a.company_id, a]));
  const ids = [...assignmentByCompany.keys()];
  const companies: any[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabaseService.from('companies')
      .select('id,name,website,stage,sector,workspace_id,is_confidential,classification:profile->triage->>classification,internal:profile->internal,archived:profile->archived,imported_lead:attributes->importedLead,lead_email:attributes->>leadEmail,lead_phone:attributes->>leadPhone')
      .eq('workspace_id', scope.workspaceId).eq('is_confidential', false)
      .contains('attributes', { importedLead: { version: 1 } }).in('id', ids.slice(offset, offset + 100));
    if (error) throw error;
    companies.push(...(data || []));
  }
  const contactIds = [...new Set(companies.flatMap(c => Array.isArray(c.imported_lead?.contactIds) ? c.imported_lead.contactIds.filter((id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) : []))] as string[];
  const contacts: any[] = [];
  for (let offset = 0; offset < contactIds.length; offset += 100) {
    const { data, error } = await supabaseService.from('contacts')
      .select('id,company_id,workspace_id,name,role,email,phone:attributes->>phone,linkedin_url:attributes->>linkedin_url')
      .eq('workspace_id', scope.workspaceId).in('id', contactIds.slice(offset, offset + 100));
    if (error) throw error;
    contacts.push(...(data || []));
  }
  const assigneeIds = [...new Set(assignments.map(a => a.assigned_to_user_id).filter(Boolean))];
  const names = new Map<string, string>();
  for (let offset = 0; offset < assigneeIds.length; offset += 100) {
    const { data, error } = await supabaseService.from('profiles').select('user_id,display_name').in('user_id', assigneeIds.slice(offset, offset + 100));
    if (error) throw error;
    for (const p of data || []) names.set(p.user_id, p.display_name || 'Assigned teammate');
  }
  const leads: AssignedLead[] = [];
  for (const company of companies) {
    if (company.internal === true || company.archived === true || sharedClientBlockReason({ ...company, profile: { triage: { classification: company.classification } } })) continue;
    const assignment = assignmentByCompany.get(company.id);
    const lead = projectAssignedLead(company, assignment, viewer, names.get(assignment?.assigned_to_user_id) || 'Assigned teammate', contacts);
    if (lead) leads.push(lead);
  }
  leads.sort(compareLeadAdded);
  const visibleOwners = new Set(leads.map(l => l.assignedTo));
  return { leads, isOwner, owners: [...names].filter(([id]) => visibleOwners.has(id)).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) };
}
