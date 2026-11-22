import { NextResponse } from 'next/server';
import { crmBlockerPayload } from '@/lib/crm-blocker';
export function crmIdentityError(error: unknown) {
  const code = String((error as any)?.message || '');
  const contact = code.includes('crm_contact_email');
  if (!contact && !code.includes('crm_company_domain')) return null;
  const conflict = code.includes('conflict');
  return NextResponse.json(crmBlockerPayload({ code: contact ? conflict ? 'contact_email_conflict' : 'contact_email_invalid' : conflict ? 'company_domain_conflict' : 'company_domain_invalid', title: conflict ? 'Duplicate record prevented' : 'Check the contact details', reason: conflict ? `This ${contact ? 'email address' : 'company domain'} is already held in this workspace` : `The ${contact ? 'email addresses' : 'company domain'} are not valid`, nextAction: conflict ? 'Open the existing company or ask Lee to confirm its owner. Your entered details have not been discarded' : 'Correct the value and save again', outcome: 'This save was rejected before it changed the record', responsible: conflict ? 'owner' : 'user' }), { status: conflict ? 409 : 400 });
}
