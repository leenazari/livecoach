// A projection of canonical client records, not a second lead database.
export const IMPORTED_LEAD_VERSION = 1;
export const LEAD_STATUSES = ['new', 'contacted', 'demo_done', 'no_response', 'not_interested', 'on_hold'] as const;
export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'Not contacted', contacted: 'Contacted', demo_done: 'Demo done',
  no_response: 'No response', not_interested: 'Not interested', on_hold: 'Do not contact',
};
export type AssignedLead = {
  id: string; companyName: string; website: string; stage: string;
  assignedTo: string; ownerName: string; contactName: string; contactRole: string;
  email: string; emailKind: string; phone: string; linkedinUrl: string;
  holdingPageUrl: string; status: string; sourceStatus: string; sourceDate: string;
  signal: string; signalUrl: string; notes: string;
  restriction: string; emailHistory: string; pageStatus: string; demoOpened: string;
  companyOverview: string; importedAt: string;
};
export type AssignedLeadList = {
  leads: AssignedLead[]; total: number; allCount: number; page: number; pageSize: number;
  isOwner: boolean; owners: { id: string; name: string }[];
};
const text = (v: unknown, max = 2000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function safeLeadUrl(value: unknown): string {
  try {
    const url = new URL(text(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function importedLeadStatus(value: unknown, restriction: unknown = ''): string {
  const raw = text(value).toLowerCase();
  if (raw.includes('not interested')) return 'not_interested';
  if (/do not|paused|hold|not interested/.test(text(restriction).toLowerCase())) return 'on_hold';
  if (/do not|paused|hold/.test(raw)) return 'on_hold';
  if (raw === 'demo done') return 'demo_done';
  if (raw === 'no response') return 'no_response';
  return raw === 'new' ? 'new' : 'contacted';
}
export function projectAssignedLead(company: any, assignment: any, viewer: { userId: string; workspaceId: string; role: string }, ownerName: string, contacts: any[] = []): AssignedLead | null {
  const lead = company?.imported_lead;
  if (company?.workspace_id !== viewer.workspaceId || assignment?.workspace_id !== viewer.workspaceId ||
      assignment?.company_id !== company?.id || assignment?.status !== 'active' ||
      !assignment?.assigned_to_user_id || lead?.version !== IMPORTED_LEAD_VERSION ||
      (viewer.role !== 'owner' && assignment.assigned_to_user_id !== viewer.userId)) return null;
  const contactIds = Array.isArray(lead.contactIds) ? lead.contactIds : [];
  const people = contactIds.map((id: string) => contacts.find(c => c.id === id && c.company_id === company.id && c.workspace_id === viewer.workspaceId)).filter(Boolean);
  const first = people[0];
  const email = text(first?.email || company.lead_email, 254);
  // Contacts and assignments are canonical. The import metadata holds only the
  // source context and links that have no ordinary company/contact column.
  // Explicit allowlist. Never spread attributes, profiles, email context or private notes.
  return {
    id: company.id, companyName: text(company.name, 200), website: safeLeadUrl(company.website),
    stage: text(company.stage, 80), assignedTo: assignment.assigned_to_user_id, ownerName,
    contactName: people.map((c: any) => text(c.name, 180)).join(', '), contactRole: text(first?.role, 250),
    email: /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email) ? email : '',
    emailKind: 'Email',
    phone: text(first?.phone || company.lead_phone, 300), linkedinUrl: safeLeadUrl(first?.linkedin_url), holdingPageUrl: safeLeadUrl(lead.holdingPageUrl),
    status: importedLeadStatus(lead.sourceStatus, lead.restriction), sourceStatus: text(lead.sourceStatus, 100),
    sourceDate: text(lead.sourceDate, 40), importedAt: text(lead.importedAt, 40),
    signal: text(lead.signal), signalUrl: safeLeadUrl(lead.signalUrl),
    notes: text(lead.notes, 8000), restriction: text(lead.restriction, 1200),
    emailHistory: text(lead.emailHistory, 4000), pageStatus: text(lead.pageStatus, 120), demoOpened: text(lead.demoOpened, 400),
    companyOverview: text(lead.companyOverview, 1200),
  };
}
