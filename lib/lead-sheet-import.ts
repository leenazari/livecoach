// Deterministic, token-free import mapping. Deliberately excludes columns I, J,
// Q, R, T, U, V and W. Imported email copy is never queued or marked approved.
export function leadCompanyName(value: string): string {
  const base = value.trim().split(/\s+\(/)[0];
  return base.replace(/^Car,\s+Van/, 'Car， Van').split(',')[0].replace('，', ',').trim();
}
export function leadDomain(value: string): string {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
export function leadEmail(value: string): string {
  return value.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() || '';
}
export function sheetLeadMapping(row: Record<string, string>, source: { spreadsheetId: string; sheetId: string; row: number }, members: { user_id: string; display_name: string; status: string }[]) {
  const owner = row.owner?.trim().toLowerCase();
  const matches = members.filter(m => m.status === 'active' && (m.display_name.toLowerCase() === owner || m.display_name.toLowerCase().split(' ')[0] === owner));
  if (!owner || matches.length !== 1) throw new Error(`Row ${source.row} needs one active, unambiguous owner`);
  const companyName = leadCompanyName(row.company || '');
  if (!companyName) throw new Error(`Row ${source.row} has no company`);
  const website = /^https?:\/\/\S+$/.test(row.website || '') ? row.website : '';
  const domain = leadDomain(website);
  const identity = domain || companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const sourceRef = `google-sheet:${source.spreadsheetId}:${source.sheetId}:${identity}`;
  const holdingPageUrl = /^https?:\/\/\S+$/.test(row['demo link'] || '') ? row['demo link'] : '';
  const email = leadEmail(row['Email address'] || '');
  const rawContact = (row.contact || '').trim();
  const contactNames = /not verified|name not verified|@/i.test(rawContact) ? [] : rawContact.split(';').map(s => s.trim()).filter(Boolean);
  return {
    sourceRef, companyName, domain, website, assignedTo: matches[0].user_id,
    contactNames, role: row.role || '', email, phone: row['Phone number'] || '', linkedinUrl: row['LinkedIn URL'] || '',
    importedLead: {
      version: 1, sourceRef, sourceRow: source.row, sourceDate: row.date || '',
      companyOverview: row.company || '', holdingPageUrl, sourceStatus: row.status || 'new',
      signal: row.signal || '', signalUrl: row['signal link'] || '',
      notes: row['last update / response notes'] || '',
      restriction: row['Owner / do not contact'] || (row.status === 'not interested' ? 'Not interested. Do not send further outreach.' : ''),
      emailHistory: row['Emails sent (dates)'] || '', pageStatus: row['page status'] || '', demoOpened: row['demo opened'] || '',
    },
  };
}
