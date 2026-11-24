import { LEAD_STATUSES, LEAD_VIEWS, LEAD_DEMO_FILTERS, LEAD_CONTACT_FILTERS, LEAD_SORTS } from '@/lib/assigned-new-leads';

export type LeadListFilters = { page: number; owner: string; status: string; query: string; view: string; demo: string; contact: string; sort: string };
export const defaultLeadListFilters: LeadListFilters = { page: 1, owner: '', status: '', query: '', view: 'all', demo: 'any', contact: 'any', sort: 'newest' };
const keys = Object.keys(defaultLeadListFilters) as (keyof LeadListFilters)[];
export function readLeadListFilters(params: URLSearchParams): LeadListFilters {
  const read = (key: string) => params.get(`lead_${key}`) || '';
  const choice = (key: string, choices: readonly string[], fallback: string) => choices.includes(read(key)) ? read(key) : fallback;
  const page = Number(read('page'));
  return {
    page: Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1,
    owner: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(read('owner')) ? read('owner') : '',
    query: read('query').trim().slice(0, 160),
    status: choice('status', LEAD_STATUSES, ''), view: choice('view', LEAD_VIEWS, 'all'),
    demo: choice('demo', LEAD_DEMO_FILTERS, 'any'), contact: choice('contact', LEAD_CONTACT_FILTERS, 'any'), sort: choice('sort', LEAD_SORTS, 'newest'),
  };
}
export function writeLeadListFilters(params: URLSearchParams, filters: LeadListFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of keys) {
    if (filters[key] === defaultLeadListFilters[key]) next.delete(`lead_${key}`);
    else next.set(`lead_${key}`, String(filters[key]));
  }
  return next;
}
