// Browser-safe projection. These are existing CRM records, not a mailbox sync.
export type RecordedCompanyEmail = {
  id: string;
  companyId: string;
  direction: 'sent' | 'received';
  at: string;
  subject: string;
  correspondent: string;
  source: 'Outreach' | 'Email assistant' | 'Recorded reply' | 'Connected mailbox';
  text?: string;
  truncated?: boolean;
};
export type RecordedCompanyEmailHistory = {
  messages: RecordedCompanyEmail[];
  limited: boolean;
  mailbox?: string;
  matchedEmail?: string;
  searchScope?: string;
};

export function recordedEmailDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : 'Date not recorded';
}
