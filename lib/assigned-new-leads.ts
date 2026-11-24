import type { RecordedCompanyEmail } from '@/lib/recorded-company-emails';
// A projection of canonical client records, not a second lead database.
export const IMPORTED_LEAD_VERSION = 1;
export const LEAD_STATUSES = ['new', 'contacted', 'demo_done', 'no_response', 'not_interested', 'on_hold'] as const;
export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'Not contacted', contacted: 'Contacted', demo_done: 'Demo done',
  no_response: 'No response', not_interested: 'Not interested', on_hold: 'Do not contact',
};
export const LEAD_VIEWS = ['all', 'not_contacted', 'follow_up', 'needs_details'] as const;
export const LEAD_VIEW_LABELS: Record<string, string> = { all: 'All leads', not_contacted: 'Not contacted', follow_up: 'Follow-ups', needs_details: 'Needs details' };
export const LEAD_DEMO_FILTERS = ['any', 'available', 'missing', 'opened'] as const;
export const LEAD_CONTACT_FILTERS = ['any', 'email', 'phone', 'missing'] as const;
export const LEAD_SORTS = ['newest', 'oldest', 'company'] as const;
export type AssignedLead = {
  id: string; companyName: string; website: string; stage: string;
  campaign?: string; criteriaVersion?: string; activity?: Record<string, string>; opportunityId?: string;
  assignedTo: string; ownerName: string; contactName: string; contactRole: string;
  email: string; emailKind: string; phone: string; linkedinUrl: string;
  holdingPageUrl: string; status: string; sourceStatus: string; sourceDate: string;
  signal: string; signalUrl: string; notes: string;
  restriction: string; emailHistory: string; pageStatus: string; demoOpened: string;
  companyOverview: string; importedAt: string; sourceOrder: number;
  recentEmail?: RecordedCompanyEmail;
};
export type AssignedLeadList = {
  leads: AssignedLead[]; total: number; allCount: number; page: number; pageSize: number;
  isOwner: boolean; owners: { id: string; name: string }[];
  viewCounts: Record<string, number>;
  emailHistoryAvailable?: boolean;
};
const text = (v: unknown, max = 2000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function safeLeadUrl(value: unknown): string {
  try {
    const url = new URL(text(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function importedLeadStatus(value: unknown, restriction: unknown = '', emailHistory: unknown = ''): string {
  const raw = text(value).toLowerCase();
  if (raw.includes('not interested')) return 'not_interested';
  if (/do not|paused|hold|not interested/.test(text(restriction).toLowerCase())) return 'on_hold';
  if (/do not|paused|hold/.test(raw)) return 'on_hold';
  if (raw === 'demo done') return 'demo_done';
  if (raw === 'no response') return 'no_response';
  if (raw === 'new' && /^\s*(sent\s+\d|email\s+\d+\s*:\s*\d)/i.test(text(emailHistory, 4000))) return 'contacted';
  return raw === 'new' ? 'new' : 'contacted';
}
export function hasDemoOpened(lead: AssignedLead): boolean {
  const value = lead.demoOpened.trim().toLowerCase();
  return !!value && !/^(no|false|0|never|not (yet )?opened|unopened|n\/a|unknown|pending)(\b|$)/.test(value);
}
export function hasLeadPhone(lead: AssignedLead): boolean {
  return lead.phone.replace(/\D/g, '').length >= 7;
}
export function matchesLeadView(lead: AssignedLead, view: string): boolean {
  if (view === 'all') return true;
  if (['on_hold', 'not_interested'].includes(lead.status)) return false;
  if (view === 'not_contacted') return lead.status === 'new';
  if (view === 'follow_up') return ['contacted', 'no_response'].includes(lead.status);
  return view === 'needs_details' && (!lead.contactName || (!lead.email && !hasLeadPhone(lead)) || !lead.holdingPageUrl);
}
export function compareLeadAdded(a: AssignedLead, b: AssignedLead): number {
  const added = (lead: AssignedLead) => Date.parse(lead.sourceDate) || Date.parse(lead.importedAt) || 0;
  return added(b) - added(a) || b.sourceOrder - a.sourceOrder || b.importedAt.localeCompare(a.importedAt) || a.companyName.localeCompare(b.companyName) || a.id.localeCompare(b.id);
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
    status: importedLeadStatus(lead.sourceStatus, lead.restriction, lead.emailHistory), sourceStatus: text(lead.sourceStatus, 100),
    sourceDate: text(lead.sourceDate, 40), importedAt: text(lead.importedAt, 40),
    sourceOrder: Number.isSafeInteger(lead.sourceRow) && lead.sourceRow >= 0 ? lead.sourceRow : 0,
    signal: text(lead.signal), signalUrl: safeLeadUrl(lead.signalUrl),
    notes: text(lead.notes, 8000), restriction: text(lead.restriction, 1200),
    emailHistory: text(lead.emailHistory, 4000), pageStatus: text(lead.pageStatus, 120), demoOpened: text(lead.demoOpened, 400),
    companyOverview: text(lead.companyOverview, 1200),
  };
}
