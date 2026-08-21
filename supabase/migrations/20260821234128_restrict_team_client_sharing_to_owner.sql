-- Sharing private client records is an owner-only privacy decision. Managers
-- and salespeople can work with an active safe projection, but cannot create,
-- revoke or inspect old access decisions through the Data API.
drop policy if exists "Members read active shared clients"
  on public.team_client_shares;
drop policy if exists "Owners share their private clients"
  on public.team_client_shares;
drop policy if exists "Owners change their client sharing"
  on public.team_client_shares;

create policy "Members read active shared clients"
  on public.team_client_shares for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = team_client_shares.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          team_client_shares.status = 'active'
          or wm.role = 'owner'
        )
    )
  );

create policy "Owners share their private clients"
  on public.team_client_shares for insert to authenticated
  with check (
    shared_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = team_client_shares.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
    and exists (
      select 1
      from public.companies c
      where c.id = team_client_shares.company_id
        and c.workspace_id = team_client_shares.workspace_id
        and c.owner_id = (select auth.uid())
    )
  );

create policy "Owners change their client sharing"
  on public.team_client_shares for update to authenticated
  using (
    shared_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = team_client_shares.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role = 'owner'
    )
  )
  with check (
    shared_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.companies c
      where c.id = team_client_shares.company_id
        and c.workspace_id = team_client_shares.workspace_id
        and c.owner_id = (select auth.uid())
    )
  );
