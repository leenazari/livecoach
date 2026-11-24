import type { AssignedLead } from '@/lib/assigned-new-leads';

export type LeadWorkspace = {
  lead: AssignedLead;
  notes: { id: string; title: string; content: string; createdAt: string }[];
  tasks: { id: string; text: string; dueAt: string | null }[];
  opportunity: { id: string; title: string; stage: string; nextAction: string; dueAt: string | null } | null;
  limited: { notes: boolean; tasks: boolean };
};

export type LeadFormState = { dirty: boolean; busy: boolean; listening: boolean };

export function leadDate(value: string | null | undefined): string {
  if (!value) return 'No date set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(date);
}
