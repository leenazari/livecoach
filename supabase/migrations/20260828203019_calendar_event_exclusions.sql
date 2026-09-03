-- A crossed-off provider event remains in Google or Microsoft Calendar but is
-- intentionally excluded from LiveCoach. The record is private to one user so
-- one salesperson can never hide another person's meeting.
create table if not exists public.calendar_event_exclusions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  source text not null check (source in ('google', 'microsoft')),
  external_id text not null check (length(external_id) between 1 and 500),
  title text check (title is null or length(title) <= 300),
  created_at timestamptz not null default now(),
  unique (workspace_id, owner_id, source, external_id)
);

create index if not exists calendar_event_exclusions_owner_source_idx
  on public.calendar_event_exclusions (owner_id, workspace_id, source);

alter table public.calendar_event_exclusions enable row level security;

revoke all on table public.calendar_event_exclusions from public, anon, authenticated;
grant select, insert on table public.calendar_event_exclusions to authenticated;
grant all on table public.calendar_event_exclusions to service_role;

create policy "Users read their own calendar exclusions"
  on public.calendar_event_exclusions for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = calendar_event_exclusions.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Users create their own calendar exclusions"
  on public.calendar_event_exclusions for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = calendar_event_exclusions.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

comment on table public.calendar_event_exclusions is
  'Private per-user provider events intentionally hidden from LiveCoach while remaining in the source calendar.';
