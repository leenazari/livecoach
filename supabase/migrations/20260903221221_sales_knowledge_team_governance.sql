-- Turn the existing lessons library into a governed sales knowledge source.
-- Private principles keep their current behaviour. Team-visible sales lessons
-- are readable by active workspace members, but only their author can edit or
-- remove them and only an owner or manager can publish one to the team.

alter table public.lessons
  add column if not exists kind text not null default 'principle',
  add column if not exists status text not null default 'approved',
  add column if not exists source_label text,
  add column if not exists source_fingerprint text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.lessons
  drop constraint if exists lessons_kind_check,
  add constraint lessons_kind_check
    check (kind in ('principle', 'sales_call', 'field_note')),
  drop constraint if exists lessons_status_check,
  add constraint lessons_status_check
    check (status in ('draft', 'approved', 'archived')),
  drop constraint if exists lessons_source_label_length_check,
  add constraint lessons_source_label_length_check
    check (source_label is null or length(source_label) <= 200),
  drop constraint if exists lessons_source_fingerprint_check,
  add constraint lessons_source_fingerprint_check
    check (
      source_fingerprint is null
      or source_fingerprint ~ '^[a-f0-9]{64}$'
    );

update public.lessons
set
  kind = 'sales_call',
  status = 'approved',
  source_label = coalesce(source_label, 'Approved LiveCoach sales call')
where topic = 'pitching'
  and source_url like 'livecoach://call/%';

create unique index if not exists lessons_workspace_source_fingerprint_uidx
  on public.lessons (workspace_id, source_fingerprint)
  where source_fingerprint is not null;

create index if not exists lessons_workspace_topic_status_idx
  on public.lessons (workspace_id, topic, status, created_at desc);

create or replace function public.lessons_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lessons_touch_updated_at on public.lessons;
create trigger lessons_touch_updated_at
  before update on public.lessons
  for each row execute function public.lessons_touch_updated_at();

drop policy if exists "Members read permitted records" on public.lessons;
drop policy if exists "Members create records in their workspace" on public.lessons;
drop policy if exists "Members update permitted records" on public.lessons;
drop policy if exists "Owners delete permitted records" on public.lessons;

create policy "Members read approved team knowledge"
  on public.lessons for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = lessons.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
    and (
      owner_id = (select auth.uid())
      or (visibility = 'team' and status = 'approved')
    )
  );

create policy "Members create owned knowledge"
  on public.lessons for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = lessons.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          lessons.visibility = 'private'
          or (
            lessons.visibility = 'team'
            and lessons.status = 'approved'
            and wm.role in ('owner', 'manager')
          )
        )
    )
  );

create policy "Authors update owned knowledge"
  on public.lessons for update to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = lessons.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = lessons.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          lessons.visibility = 'private'
          or (
            lessons.visibility = 'team'
            and lessons.status = 'approved'
            and wm.role in ('owner', 'manager')
          )
        )
    )
  );

create policy "Authors delete owned knowledge"
  on public.lessons for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = lessons.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and (
          lessons.visibility = 'private'
          or wm.role in ('owner', 'manager')
        )
    )
  );

revoke execute on function public.lessons_touch_updated_at() from public, anon;
grant execute on function public.lessons_touch_updated_at() to authenticated, service_role;
