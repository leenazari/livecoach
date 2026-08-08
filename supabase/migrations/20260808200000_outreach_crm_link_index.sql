-- Keep outreach-to-CRM lookups fast as the prospect database grows.
create index if not exists outreach_prospects_crm_company_idx
  on public.outreach_prospects (crm_company_id)
  where crm_company_id is not null;
