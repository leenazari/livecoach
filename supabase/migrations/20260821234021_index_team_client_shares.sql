-- Cover both foreign-key delete checks and the owner audit/filter paths. The
-- main workspace/status index remains the list-view index.
create index team_client_shares_company_idx
  on public.team_client_shares (company_id);

create index team_client_shares_shared_by_idx
  on public.team_client_shares (shared_by_user_id);
