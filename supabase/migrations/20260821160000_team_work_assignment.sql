-- Add an explicit work owner without changing the privacy owner of a record.
-- `owner_id` continues to identify whose private data a row belongs to.
-- `assigned_to_user_id` identifies the active teammate responsible for the
-- shared sales work. Existing rows remain with Lee and no record is deleted.

alter table public.profiles
  add column if not exists outreach_sender_name text,
  add column if not exists outreach_sender_email text;

alter table public.outreach_prospects
  add column if not exists assigned_to_user_id uuid;

alter table public.opportunities
  add column if not exists assigned_to_user_id uuid;

alter table public.outreach_messages
  add column if not exists sender_user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outreach_prospects_assigned_to_user_id_fkey'
      and conrelid = 'public.outreach_prospects'::regclass
  ) then
    alter table public.outreach_prospects
      add constraint outreach_prospects_assigned_to_user_id_fkey
      foreign key (assigned_to_user_id) references auth.users(id)
      on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_assigned_to_user_id_fkey'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities
      add constraint opportunities_assigned_to_user_id_fkey
      foreign key (assigned_to_user_id) references auth.users(id)
      on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'outreach_messages_sender_user_id_fkey'
      and conrelid = 'public.outreach_messages'::regclass
  ) then
    alter table public.outreach_messages
      add constraint outreach_messages_sender_user_id_fkey
      foreign key (sender_user_id) references auth.users(id)
      on delete restrict not valid;
  end if;
end
$$;

-- Preserve the existing operational owner. This is assignment only and does
-- not promote any private company, call, transcript, document or opportunity.
update public.outreach_prospects
set assigned_to_user_id = owner_id
where assigned_to_user_id is null;

update public.opportunities
set assigned_to_user_id = owner_id
where assigned_to_user_id is null;

update public.outreach_messages
set sender_user_id = owner_id
where sender_user_id is null;

-- Lee's verified Gmail alias remains the visible sender. Future accounts use
-- their own connected Google email unless they configure a verified alias.
update public.profiles p
set outreach_sender_name = coalesce(
      nullif(trim(p.outreach_sender_name), ''),
      nullif(trim(p.display_name), ''),
      'LiveCoach'
    ),
    outreach_sender_email = coalesce(
      nullif(lower(trim(p.outreach_sender_email)), ''),
      case
        when wm.role = 'owner' then (
          select nullif(lower(trim(ac.value)), '')
          from public.app_config ac
          where ac.workspace_id = wm.workspace_id
            and ac.key = 'outreach_from_email'
          order by (ac.visibility = 'team') desc, ac.updated_at desc
          limit 1
        )
        else null
      end,
      (
        select nullif(lower(trim(goa.email)), '')
        from public.google_oauth goa
        where goa.owner_id = p.user_id
        order by goa.updated_at desc
        limit 1
      ),
      nullif(lower(trim(p.email)), '')
    ),
    updated_at = now()
from public.workspace_members wm
where wm.user_id = p.user_id;

alter table public.profiles
  drop constraint if exists profiles_outreach_sender_name_check,
  add constraint profiles_outreach_sender_name_check
    check (
      outreach_sender_name is null
      or length(trim(outreach_sender_name)) between 1 and 120
    ) not valid,
  drop constraint if exists profiles_outreach_sender_email_check,
  add constraint profiles_outreach_sender_email_check
    check (
      outreach_sender_email is null
      or outreach_sender_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ) not valid;

alter table public.profiles
  validate constraint profiles_outreach_sender_name_check,
  validate constraint profiles_outreach_sender_email_check;

alter table public.outreach_messages
  alter column sender_user_id set not null;

alter table public.outreach_prospects
  validate constraint outreach_prospects_assigned_to_user_id_fkey;
alter table public.opportunities
  validate constraint opportunities_assigned_to_user_id_fkey;
alter table public.outreach_messages
  validate constraint outreach_messages_sender_user_id_fkey;

create index if not exists outreach_prospects_workspace_assignee_status_idx
  on public.outreach_prospects (workspace_id, assigned_to_user_id, status, priority_score desc);

create index if not exists opportunities_workspace_assignee_status_idx
  on public.opportunities (workspace_id, assigned_to_user_id, status, updated_at desc);

create index if not exists outreach_messages_sender_schedule_idx
  on public.outreach_messages (sender_user_id, status, scheduled_at)
  where status = 'approved';

create or replace function public.validate_livecoach_work_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  assignee_id uuid := case
    when tg_table_name = 'outreach_messages' then new.sender_user_id
    else new.assigned_to_user_id
  end;
begin
  if assignee_id is null then
    if tg_table_name = 'outreach_messages' then
      raise exception 'an outreach sender is required';
    end if;
    if tg_op = 'INSERT' then
      new.assigned_to_user_id := new.owner_id;
      assignee_id := new.owner_id;
    else
      return new;
    end if;
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = assignee_id
      and wm.status = 'active'
  ) then
    raise exception 'the assigned user is not an active member of this workspace';
  end if;

  if tg_table_name = 'outreach_messages' then
    if not exists (
      select 1
      from public.outreach_prospects op
      where op.id = new.prospect_id
        and op.workspace_id = new.workspace_id
        and (
          op.assigned_to_user_id is null
          or op.assigned_to_user_id = new.sender_user_id
        )
    ) then
      raise exception 'the outreach sender is not assigned to this prospect';
    end if;

    if not exists (
      select 1
      from public.profiles p
      where p.user_id = new.sender_user_id
        and lower(p.outreach_sender_email) = lower(new.from_email)
    ) then
      raise exception 'the visible sender does not match the assigned account';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.protect_livecoach_work_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  old_assignee uuid := old.assigned_to_user_id;
  new_assignee uuid := new.assigned_to_user_id;
begin
  if new_assignee is not distinct from old_assignee then
    return new;
  end if;
  if actor_id is null then
    return new;
  end if;

  select wm.role into actor_role
  from public.workspace_members wm
  where wm.workspace_id = old.workspace_id
    and wm.user_id = actor_id
    and wm.status = 'active';

  if actor_role in ('owner', 'manager') then
    return new;
  end if;
  if actor_role = 'sales'
    and (
      (old_assignee is null and new_assignee = actor_id)
      or (old_assignee = actor_id and new_assignee is null)
    ) then
    return new;
  end if;

  raise exception 'only an owner or manager can reassign another person''s work';
end;
$$;

create or replace function public.protect_livecoach_outreach_message()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
begin
  if tg_op = 'UPDATE'
    and (
      new.sender_user_id is distinct from old.sender_user_id
      or new.from_email is distinct from old.from_email
    ) then
    raise exception 'an outreach message sender cannot change after drafting';
  end if;
  if actor_id is null then
    return new;
  end if;

  select wm.role into actor_role
  from public.workspace_members wm
  where wm.workspace_id = coalesce(new.workspace_id, old.workspace_id)
    and wm.user_id = actor_id
    and wm.status = 'active';

  if actor_role in ('owner', 'manager')
    or coalesce(new.sender_user_id, old.sender_user_id) = actor_id then
    return new;
  end if;
  raise exception 'this outreach message belongs to another sender';
end;
$$;

create or replace function public.audit_livecoach_work_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.assigned_to_user_id is not distinct from old.assigned_to_user_id then
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
    (select auth.uid()),
    case when (select auth.uid()) is null then 'system' else 'human' end,
    'work_assignment_changed',
    tg_table_name,
    new.id::text,
    jsonb_build_object('assignedToUserId', old.assigned_to_user_id),
    jsonb_build_object('assignedToUserId', new.assigned_to_user_id)
  );
  return new;
end;
$$;

drop trigger if exists outreach_prospects_validate_assignment on public.outreach_prospects;
create trigger outreach_prospects_validate_assignment
  before insert or update of assigned_to_user_id, workspace_id
  on public.outreach_prospects
  for each row execute function public.validate_livecoach_work_assignment();

drop trigger if exists opportunities_validate_assignment on public.opportunities;
create trigger opportunities_validate_assignment
  before insert or update of assigned_to_user_id, workspace_id
  on public.opportunities
  for each row execute function public.validate_livecoach_work_assignment();

drop trigger if exists outreach_messages_validate_sender on public.outreach_messages;
create trigger outreach_messages_validate_sender
  before insert or update of sender_user_id, from_email, prospect_id, workspace_id
  on public.outreach_messages
  for each row execute function public.validate_livecoach_work_assignment();

drop trigger if exists outreach_prospects_protect_assignment on public.outreach_prospects;
create trigger outreach_prospects_protect_assignment
  before update of assigned_to_user_id on public.outreach_prospects
  for each row execute function public.protect_livecoach_work_assignment();

drop trigger if exists opportunities_protect_assignment on public.opportunities;
create trigger opportunities_protect_assignment
  before update of assigned_to_user_id on public.opportunities
  for each row execute function public.protect_livecoach_work_assignment();

drop trigger if exists outreach_messages_protect_sender on public.outreach_messages;
create trigger outreach_messages_protect_sender
  before update on public.outreach_messages
  for each row execute function public.protect_livecoach_outreach_message();

drop trigger if exists outreach_prospects_audit_assignment on public.outreach_prospects;
create trigger outreach_prospects_audit_assignment
  after update of assigned_to_user_id on public.outreach_prospects
  for each row execute function public.audit_livecoach_work_assignment();

drop trigger if exists opportunities_audit_assignment on public.opportunities;
create trigger opportunities_audit_assignment
  after update of assigned_to_user_id on public.opportunities
  for each row execute function public.audit_livecoach_work_assignment();

revoke execute on function public.validate_livecoach_work_assignment()
  from public, anon, authenticated;
revoke execute on function public.protect_livecoach_work_assignment()
  from public, anon, authenticated;
revoke execute on function public.protect_livecoach_outreach_message()
  from public, anon, authenticated;
revoke execute on function public.audit_livecoach_work_assignment()
  from public, anon, authenticated;

comment on column public.outreach_prospects.assigned_to_user_id is
  'Active teammate responsible for outreach. This is separate from the privacy owner.';
comment on column public.opportunities.assigned_to_user_id is
  'Active teammate responsible for progressing the deal. This does not grant access to private source records.';
comment on column public.outreach_messages.sender_user_id is
  'LiveCoach account and Google connector that owns this exact email send.';
