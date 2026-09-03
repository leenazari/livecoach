-- An active team_client_shares row is already the explicit owner-approved
-- access grant. Do not re-check the private companies row inside this SELECT
-- policy because the assignee cannot see that source row through company RLS.
-- Confidentiality remains fail closed through the sharing trigger, the
-- confidentiality lock that revokes active grants, and the server-side safe
-- company loader which filters is_confidential = false.

drop policy if exists "Members read active shared clients"
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

comment on policy "Members read active shared clients"
  on public.team_client_shares is
  'Active members may discover owner-approved safe client grants. Private company fields remain protected by company RLS and the safe shared projection.';
