-- A shared calendar call has one canonical capture and one canonical summary,
-- but every verified LiveCoach attendee on that exact calendar occurrence may
-- read the shared call artefacts. This is intentionally separate from
-- meet_capture_subscribers. Subscribers describe an active private coaching
-- stream and are closed when that browser ends its session. Access survives the
-- live call so the organiser and invited teammates can open the summary and
-- download the same stored transcript afterwards.

alter table public.meet_bots
  add column if not exists host_owner_id uuid
    references auth.users(id) on delete set null,
  add column if not exists canonical_upcoming_id uuid
    references public.upcoming_calls(id) on delete set null;

update public.meet_bots
set host_owner_id = coalesce(host_owner_id, owner_id),
    canonical_upcoming_id = coalesce(canonical_upcoming_id, source_upcoming_id)
where host_owner_id is null
   or canonical_upcoming_id is null;

create index if not exists meet_bots_host_session_idx
  on public.meet_bots (workspace_id, host_owner_id, session_id, created_at desc);

create table if not exists public.meet_capture_access (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.meet_bots(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  upcoming_id uuid references public.upcoming_calls(id) on delete set null,
  access_role text not null default 'attendee',
  grant_source text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint meet_capture_access_role_check
    check (access_role in ('host', 'attendee')),
  constraint meet_capture_access_grant_source_check
    check (grant_source in ('calendar_attendee', 'capture_owner')),
  unique (capture_id, user_id)
);

create index if not exists meet_capture_access_user_capture_idx
  on public.meet_capture_access (workspace_id, user_id, capture_id)
  where revoked_at is null;

create index if not exists meet_capture_access_upcoming_idx
  on public.meet_capture_access (upcoming_id)
  where upcoming_id is not null and revoked_at is null;

alter table public.meet_capture_access enable row level security;
revoke all on public.meet_capture_access from public, anon, authenticated;
grant select on public.meet_capture_access to authenticated;
grant select, insert, update, delete on public.meet_capture_access to service_role;

drop policy if exists "Members read their exact shared call access"
  on public.meet_capture_access;
create policy "Members read their exact shared call access"
  on public.meet_capture_access
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and revoked_at is null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = meet_capture_access.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

-- Keep historic and rolling-deploy captures readable by their technical owner.
-- Calendar attendees are added only by the exact-occurrence server resolver.
insert into public.meet_capture_access (
  capture_id,
  workspace_id,
  user_id,
  upcoming_id,
  access_role,
  grant_source
)
select
  mb.id,
  mb.workspace_id,
  mb.owner_id,
  mb.source_upcoming_id,
  case when mb.host_owner_id = mb.owner_id then 'host' else 'attendee' end,
  'capture_owner'
from public.meet_bots mb
on conflict (capture_id, user_id) do nothing;

comment on table public.meet_capture_access is
  'Persistent read permission for one exact calendar call capture. It grants only shared call artefacts, never the attendee owner''s private CRM records.';
comment on column public.meet_bots.host_owner_id is
  'Verified LiveCoach workspace member who organised the exact calendar occurrence and owns the shared call context.';
comment on column public.meet_bots.canonical_upcoming_id is
  'The organiser-owned scheduled call whose intent and safe focus fields are authoritative for the shared call.';
