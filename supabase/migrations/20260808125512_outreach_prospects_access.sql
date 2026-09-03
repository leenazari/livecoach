create index if not exists outreach_prospects_owner_idx
  on public.outreach_prospects (owner_id);

create policy "Service role manages outreach prospects"
  on public.outreach_prospects
  for all
  to service_role
  using (true)
  with check (true);
