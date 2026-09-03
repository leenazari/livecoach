-- A shared sales record is an explicit access decision, not a promotion of the
-- underlying company row. The original company, notes, email context, calls,
-- transcripts and Brain memory remain private. Server routes use this grant to
-- expose only a fixed set of safe company fields and already-team-visible
-- opportunities.

create table public.team_client_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  shared_by_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, company_id)
);

create index team_client_shares_workspace_status_idx
  on public.team_client_shares (workspace_id, status, updated_at desc);

create or replace function public.protect_team_client_share_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.company_id is distinct from old.company_id
    or new.shared_by_user_id is distinct from old.shared_by_user_id then
    raise exception 'A shared client identity cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.audit_team_client_share()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  insert into public.access_audit_events (
    workspace_id,
    actor_user_id,
    source,
    action,
    target_table,
    target_id,
    previous_scope,
    next_scope
  ) values (
    new.workspace_id,
    actor_id,
    case when actor_id is null then 'system' else 'human' end,
    case when new.status = 'active' then 'client_sales_access_shared'
         else 'client_sales_access_revoked' end,
    'companies',
    new.company_id::text,
    case when tg_op = 'UPDATE'
         then jsonb_build_object('salesAccess', old.status)
         else '{}'::jsonb end,
    jsonb_build_object('salesAccess', new.status)
  );
  return new;
end;
$$;

create trigger team_client_shares_protect_identity
  before update on public.team_client_shares
  for each row execute function public.protect_team_client_share_identity();

create trigger team_client_shares_audit
  after insert or update of status on public.team_client_shares
  for each row execute function public.audit_team_client_share();

alter table public.team_client_shares enable row level security;

revoke all on public.team_client_shares from public, anon, authenticated;
grant select, insert, update on public.team_client_shares to authenticated;
grant all on public.team_client_shares to service_role;

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

revoke execute on function public.protect_team_client_share_identity()
  from public, anon, authenticated;
revoke execute on function public.audit_team_client_share()
  from public, anon, authenticated;

comment on table public.team_client_shares is
  'Explicit workspace access to a safe sales projection of a private company. Source conversations and private intelligence are never promoted.';
