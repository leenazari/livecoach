-- Notification routing and a coalesced work queue, not another calendar store.
-- Only the server may read verification hashes or select a job's account.
create table public.calendar_notification_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  calendar_id text not null,
  connection_email text not null,
  token_hash text not null check (length(token_hash) = 64),
  external_id text,
  resource_id text,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','active','stopped','error')),
  last_message_number numeric not null default 0,
  needs_renewal boolean not null default false,
  last_notified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calendar_notification_channels_account_idx
  on public.calendar_notification_channels(workspace_id, owner_id, provider, calendar_id, created_at desc);
create index calendar_notification_channels_owner_idx on public.calendar_notification_channels(owner_id);

create table public.calendar_sync_jobs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  requested_version bigint not null default 1,
  completed_version bigint not null default 0,
  pending boolean generated always as (requested_version > completed_version) stored,
  requested_mode text not null default 'full' check (requested_mode in ('full','near-term')),
  lease_token uuid,
  leased_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, owner_id)
);
create index calendar_sync_jobs_pending_idx on public.calendar_sync_jobs(next_attempt_at)
  where requested_version > completed_version;
create index calendar_sync_jobs_owner_idx on public.calendar_sync_jobs(owner_id);
alter table public.calendar_notification_channels enable row level security;
alter table public.calendar_sync_jobs enable row level security;
revoke all on public.calendar_notification_channels, public.calendar_sync_jobs from public, anon, authenticated;
grant all on public.calendar_notification_channels, public.calendar_sync_jobs to service_role;

create function public.request_calendar_sync(p_workspace_id uuid, p_owner_id uuid, p_mode text default 'full')
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_mode not in ('full','near-term') then raise exception 'Invalid calendar sync mode'; end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = p_workspace_id
      and m.user_id = p_owner_id and m.status = 'active') then return false; end if;
  if not exists (select 1 from public.google_oauth g where g.workspace_id = p_workspace_id
      and g.owner_id = p_owner_id and g.refresh_token is not null)
    and not exists (select 1 from public.microsoft_oauth o where o.workspace_id = p_workspace_id
      and o.owner_id = p_owner_id and o.refresh_token is not null) then return false; end if;
  insert into public.calendar_sync_jobs as j(workspace_id, owner_id, requested_mode)
    values (p_workspace_id, p_owner_id, p_mode)
  on conflict (workspace_id, owner_id) do update set
    requested_version = j.requested_version + 1,
    requested_at = now(),
    requested_mode = case when j.requested_version = j.completed_version then p_mode
      when j.requested_mode = 'full' or p_mode = 'full' then 'full' else p_mode end,
    next_attempt_at = least(j.next_attempt_at, now());
  return true;
end $$;

create function public.claim_calendar_sync(p_workspace_id uuid, p_owner_id uuid)
returns setof public.calendar_sync_jobs language sql security invoker set search_path = '' as $$
  update public.calendar_sync_jobs j set lease_token = gen_random_uuid(), leased_until = now() + interval '330 seconds'
  where j.workspace_id = p_workspace_id and j.owner_id = p_owner_id
    and j.requested_version > j.completed_version and j.next_attempt_at <= now()
    and (j.leased_until is null or j.leased_until < now())
    and exists (select 1 from public.workspace_members m where m.workspace_id = j.workspace_id
      and m.user_id = j.owner_id and m.status = 'active')
    and (exists (select 1 from public.google_oauth g where g.workspace_id = j.workspace_id
      and g.owner_id = j.owner_id and g.refresh_token is not null)
      or exists (select 1 from public.microsoft_oauth o where o.workspace_id = j.workspace_id
      and o.owner_id = j.owner_id and o.refresh_token is not null))
  returning j.*;
$$;

create function public.finish_calendar_sync(p_workspace_id uuid, p_owner_id uuid, p_lease_token uuid,
  p_version bigint, p_error text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.calendar_sync_jobs j set
    completed_version = case when p_error is null then greatest(j.completed_version, p_version) else j.completed_version end,
    completed_at = case when p_error is null then now() else j.completed_at end,
    attempts = case when p_error is null then 0 else j.attempts + 1 end,
    last_error = left(p_error, 100),
    next_attempt_at = case when p_error is null then now()
      else now() + make_interval(secs => least(900, 30 * power(2, least(j.attempts, 5)))::integer) end,
    lease_token = null, leased_until = null
  where j.workspace_id = p_workspace_id and j.owner_id = p_owner_id
    and j.lease_token = p_lease_token and p_version <= j.requested_version;
  return found;
end $$;

-- Validate and persist before acknowledging delivery. No client-supplied user
-- IDs or event contents are used. Re-read the provider under this saved owner.
create function public.accept_calendar_change(p_channel_id uuid, p_token_hash text,
  p_external_id text, p_resource_id text default null, p_message_number numeric default null,
  p_lifecycle text default null)
returns table(workspace_id uuid, owner_id uuid) language plpgsql security invoker set search_path = '' as $$
declare c public.calendar_notification_channels;
begin
  select * into c from public.calendar_notification_channels n where n.id = p_channel_id for update;
  if not found or c.status not in ('pending','active') or c.expires_at <= now()
    or p_token_hash is null or c.token_hash <> p_token_hash or nullif(p_external_id, '') is null then return; end if;
  if c.external_id is not null and c.external_id <> p_external_id then return; end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = c.workspace_id
    and m.user_id = c.owner_id and m.status = 'active') then return; end if;
  if c.provider = 'google' then
    if p_message_number is null or p_message_number <= c.last_message_number
      or nullif(p_resource_id, '') is null
      or (c.resource_id is not null and c.resource_id <> p_resource_id)
      or not exists (select 1 from public.google_oauth g where g.workspace_id = c.workspace_id
        and g.owner_id = c.owner_id and g.refresh_token is not null
        and lower(g.email) = c.connection_email) then return; end if;
  else
    if not exists (select 1 from public.microsoft_oauth o where o.workspace_id = c.workspace_id
        and o.owner_id = c.owner_id and o.refresh_token is not null
        and lower(o.email) = c.connection_email)
      or exists (select 1 from public.google_oauth g where g.workspace_id = c.workspace_id
        and g.owner_id = c.owner_id and g.refresh_token is not null) then return; end if;
  end if;
  update public.calendar_notification_channels n set
    external_id = coalesce(n.external_id, p_external_id),
    resource_id = coalesce(n.resource_id, p_resource_id),
    last_message_number = coalesce(p_message_number, n.last_message_number),
    needs_renewal = n.needs_renewal or coalesce(p_lifecycle in ('reauthorizationRequired','subscriptionRemoved'), false),
    last_notified_at = now(), updated_at = now()
  where n.id = c.id;
  perform public.request_calendar_sync(c.workspace_id, c.owner_id, 'full');
  return query select c.workspace_id, c.owner_id;
end $$;

revoke all on function public.request_calendar_sync(uuid,uuid,text), public.claim_calendar_sync(uuid,uuid),
  public.finish_calendar_sync(uuid,uuid,uuid,bigint,text),
  public.accept_calendar_change(uuid,text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.request_calendar_sync(uuid,uuid,text), public.claim_calendar_sync(uuid,uuid),
  public.finish_calendar_sync(uuid,uuid,uuid,bigint,text),
  public.accept_calendar_change(uuid,text,text,text,numeric,text) to service_role;
