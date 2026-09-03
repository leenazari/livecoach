-- Establish the access-control foundation before a second LiveCoach account is
-- invited. The app has historically been single-user, so existing rows have no
-- reliable owner. This migration deliberately assigns every existing record to
-- the sole current auth user and keeps it private, except for the dedicated
-- outreach subsystem that the owner explicitly approved as team-visible.
--
-- This migration is additive. It does not delete, merge or reinterpret any CRM
-- record. The salesperson must not be invited until user-scoped API and Brain
-- retrieval work is complete and the isolation suite passes.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'sales')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'removed')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_status_idx
  on public.workspace_members (user_id, status, workspace_id);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'sales' check (role in ('manager', 'sales')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token_hash text unique,
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_invitations_one_pending_email_idx
  on public.workspace_invitations (workspace_id, lower(email))
  where status = 'pending';

create table if not exists public.access_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'human' check (source in ('human', 'system')),
  action text not null,
  target_table text not null,
  target_id text,
  previous_scope jsonb not null default '{}'::jsonb,
  next_scope jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists access_audit_workspace_created_idx
  on public.access_audit_events (workspace_id, created_at desc);

-- Fail closed unless this is still the expected single-user production
-- database. Guessing an owner during an access-control migration would be
-- materially less safe than stopping the migration.
do $$
declare
  current_user_count integer;
  lee_user_id uuid;
  interviewa_workspace_id uuid;
begin
  select count(*) into current_user_count from auth.users;
  if current_user_count <> 1 then
    raise exception
      'multi-user foundation expected exactly one existing auth user, found %',
      current_user_count;
  end if;

  select id into lee_user_id
  from auth.users
  order by created_at asc
  limit 1;

  insert into public.profiles (user_id, display_name)
  values (lee_user_id, 'Lee Nazari')
  on conflict (user_id) do update
    set display_name = coalesce(public.profiles.display_name, excluded.display_name),
        updated_at = now();

  insert into public.workspaces (name, slug, created_by)
  values ('Interviewa', 'interviewa', lee_user_id)
  on conflict (slug) do nothing;

  select id into interviewa_workspace_id
  from public.workspaces
  where slug = 'interviewa';

  insert into public.workspace_members (
    workspace_id, user_id, role, status, invited_by
  ) values (
    interviewa_workspace_id, lee_user_id, 'owner', 'active', lee_user_id
  )
  on conflict (workspace_id, user_id) do update
    set role = 'owner', status = 'active', updated_at = now();
end
$$;

-- Every current application table receives the same canonical scope fields.
-- Keeping the columns uniform makes it possible for RLS, the Brain, cache
-- partitioning and background jobs to share one access model.
do $$
declare
  target_table text;
  all_scoped_tables text[] := array[
    'ai_cache',
    'app_config',
    'assistant_messages',
    'call_feedback',
    'client_context',
    'coaching_points',
    'companies',
    'company_priority',
    'contact_company_overrides',
    'contacts',
    'crm_company_redirects',
    'daily_briefs',
    'departments',
    'document_jobs',
    'external_refs',
    'field_definitions',
    'follow_ups',
    'google_oauth',
    'interview_sessions',
    'interview_summaries',
    'knowledge_base',
    'knowledge_docs',
    'lessons',
    'meet_bots',
    'meet_utterances',
    'opportunities',
    'opportunity_events',
    'opportunity_signal_receipts',
    'outreach_campaigns',
    'outreach_enrolments',
    'outreach_events',
    'outreach_learnings',
    'outreach_messages',
    'outreach_prospects',
    'outreach_signals',
    'outreach_suppressions',
    'tasks',
    'upcoming_calls',
    'usage_log',
    'workspace_profile',
    'workstream_contacts',
    'workstreams'
  ];
begin
  foreach target_table in array all_scoped_tables loop
    execute format(
      'alter table public.%I add column if not exists workspace_id uuid',
      target_table
    );
    execute format(
      'alter table public.%I add column if not exists owner_id uuid',
      target_table
    );
    execute format(
      'alter table public.%I add column if not exists visibility text',
      target_table
    );

    if not exists (
      select 1
      from pg_constraint
      where conname = target_table || '_workspace_id_fkey'
        and conrelid = format('public.%I', target_table)::regclass
    ) then
      execute format(
        'alter table public.%1$I add constraint %2$I foreign key (workspace_id) references public.workspaces(id) on delete restrict not valid',
        target_table,
        target_table || '_workspace_id_fkey'
      );
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = target_table || '_owner_id_fkey'
        and conrelid = format('public.%I', target_table)::regclass
    ) then
      execute format(
        'alter table public.%1$I add constraint %2$I foreign key (owner_id) references auth.users(id) on delete restrict not valid',
        target_table,
        target_table || '_owner_id_fkey'
      );
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = target_table || '_visibility_check'
        and conrelid = format('public.%I', target_table)::regclass
    ) then
      execute format(
        'alter table public.%1$I add constraint %2$I check (visibility in (''private'', ''team'')) not valid',
        target_table,
        target_table || '_visibility_check'
      );
    end if;

    execute format(
      'create index if not exists %1$I on public.%2$I (workspace_id, visibility, owner_id)',
      target_table || '_scope_idx',
      target_table
    );
  end loop;
end
$$;

-- Assign all existing data to Lee. Only the dedicated outreach tables are
-- made team-visible. Existing companies, opportunities and conversations stay
-- private until Lee explicitly promotes them after review.
do $$
declare
  lee_user_id uuid;
  interviewa_workspace_id uuid;
  target_table text;
  private_tables text[] := array[
    'ai_cache',
    'app_config',
    'assistant_messages',
    'call_feedback',
    'client_context',
    'coaching_points',
    'companies',
    'company_priority',
    'contact_company_overrides',
    'contacts',
    'crm_company_redirects',
    'daily_briefs',
    'departments',
    'document_jobs',
    'external_refs',
    'field_definitions',
    'follow_ups',
    'google_oauth',
    'interview_sessions',
    'interview_summaries',
    'knowledge_base',
    'knowledge_docs',
    'lessons',
    'meet_bots',
    'meet_utterances',
    'opportunities',
    'opportunity_events',
    'opportunity_signal_receipts',
    'tasks',
    'upcoming_calls',
    'usage_log',
    'workspace_profile',
    'workstream_contacts',
    'workstreams'
  ];
  team_tables text[] := array[
    'outreach_campaigns',
    'outreach_enrolments',
    'outreach_events',
    'outreach_learnings',
    'outreach_messages',
    'outreach_prospects',
    'outreach_signals',
    'outreach_suppressions'
  ];
begin
  select user_id into lee_user_id
  from public.workspace_members
  where role = 'owner' and status = 'active'
  order by created_at asc
  limit 1;

  select workspace_id into interviewa_workspace_id
  from public.workspace_members
  where user_id = lee_user_id and role = 'owner' and status = 'active'
  order by created_at asc
  limit 1;

  foreach target_table in array private_tables loop
    if target_table = 'opportunity_events' then
      alter table public.opportunity_events
        disable trigger opportunity_events_immutable;
    end if;

    execute format(
      'update public.%I set workspace_id = $1, owner_id = $2, visibility = ''private'' where workspace_id is null or owner_id is null or visibility is null',
      target_table
    ) using interviewa_workspace_id, lee_user_id;
    execute format(
      'alter table public.%I alter column visibility set default ''private''',
      target_table
    );

    if target_table = 'opportunity_events' then
      alter table public.opportunity_events
        enable trigger opportunity_events_immutable;
    end if;
  end loop;

  foreach target_table in array team_tables loop
    execute format(
      'update public.%I set workspace_id = $1, owner_id = $2, visibility = ''team'' where workspace_id is null or owner_id is null or visibility is null',
      target_table
    ) using interviewa_workspace_id, lee_user_id;
    execute format(
      'alter table public.%I alter column visibility set default ''team''',
      target_table
    );
  end loop;
end
$$;

-- Current server routes still use service-role writes. Until they are replaced
-- with request-scoped clients, this trigger prevents newly created rows from
-- becoming unowned. Authenticated writes inherit the caller. Legacy server and
-- cron writes inherit the sole workspace owner and must be made explicit before
-- another member is invited.
create or replace function public.apply_livecoach_record_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  default_visibility text := coalesce(nullif(tg_argv[0], ''), 'private');
  fallback_workspace_id uuid;
  fallback_owner_id uuid;
begin
  if new.owner_id is null then
    new.owner_id := (select auth.uid());
  end if;

  if new.workspace_id is null and new.owner_id is not null then
    select wm.workspace_id into new.workspace_id
    from public.workspace_members wm
    where wm.user_id = new.owner_id and wm.status = 'active'
    order by wm.created_at asc
    limit 1;
  end if;

  if new.workspace_id is null or new.owner_id is null then
    select wm.workspace_id, wm.user_id
      into fallback_workspace_id, fallback_owner_id
    from public.workspace_members wm
    where wm.role = 'owner' and wm.status = 'active'
    order by wm.created_at asc
    limit 1;

    new.workspace_id := coalesce(new.workspace_id, fallback_workspace_id);
    new.owner_id := coalesce(new.owner_id, fallback_owner_id);
  end if;

  new.visibility := coalesce(new.visibility, default_visibility);

  if new.workspace_id is null or new.owner_id is null then
    raise exception 'record scope could not be resolved';
  end if;

  return new;
end;
$$;

-- Only a workspace owner or manager can change ownership or visibility. Normal
-- sales edits to a team record remain allowed, while privacy promotion requires
-- an explicit privileged action that can be audited.
create or replace function public.protect_livecoach_record_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
begin
  if new.workspace_id is not distinct from old.workspace_id
    and new.owner_id is not distinct from old.owner_id
    and new.visibility is not distinct from old.visibility then
    return new;
  end if;

  -- Service-role and direct database maintenance have no end-user JWT. They are
  -- allowed here but must still create an audit entry in the following trigger.
  if actor_id is null then
    return new;
  end if;

  select wm.role into actor_role
  from public.workspace_members wm
  where wm.workspace_id = old.workspace_id
    and wm.user_id = actor_id
    and wm.status = 'active';

  if actor_role is null or actor_role not in ('owner', 'manager') then
    raise exception 'only a workspace owner or manager can change record access';
  end if;

  return new;
end;
$$;

create or replace function public.audit_livecoach_record_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_id uuid := (select auth.uid());
  record_id text;
begin
  if new.workspace_id is not distinct from old.workspace_id
    and new.owner_id is not distinct from old.owner_id
    and new.visibility is not distinct from old.visibility then
    return new;
  end if;

  record_id := coalesce(
    to_jsonb(new)->>'id',
    to_jsonb(new)->>'key',
    to_jsonb(new)->>'target',
    to_jsonb(new)->>'company_id'
  );

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
    'record_scope_changed',
    tg_table_name,
    record_id,
    jsonb_build_object(
      'workspaceId', old.workspace_id,
      'ownerId', old.owner_id,
      'visibility', old.visibility
    ),
    jsonb_build_object(
      'workspaceId', new.workspace_id,
      'ownerId', new.owner_id,
      'visibility', new.visibility
    )
  );

  return new;
end;
$$;

do $$
declare
  target_table text;
  private_tables text[] := array[
    'ai_cache', 'app_config', 'assistant_messages', 'call_feedback',
    'client_context', 'coaching_points', 'companies', 'company_priority',
    'contact_company_overrides', 'contacts', 'crm_company_redirects',
    'daily_briefs', 'departments', 'document_jobs', 'external_refs',
    'field_definitions', 'follow_ups', 'google_oauth', 'interview_sessions',
    'interview_summaries', 'knowledge_base', 'knowledge_docs', 'lessons',
    'meet_bots', 'meet_utterances', 'opportunities', 'opportunity_events',
    'opportunity_signal_receipts', 'tasks', 'upcoming_calls', 'usage_log',
    'workspace_profile', 'workstream_contacts', 'workstreams'
  ];
  team_tables text[] := array[
    'outreach_campaigns', 'outreach_enrolments', 'outreach_events',
    'outreach_learnings', 'outreach_messages', 'outreach_prospects',
    'outreach_signals', 'outreach_suppressions'
  ];
begin
  foreach target_table in array private_tables loop
    execute format(
      'drop trigger if exists livecoach_apply_scope on public.%I',
      target_table
    );
    execute format(
      'create trigger livecoach_apply_scope before insert on public.%I for each row execute function public.apply_livecoach_record_scope(''private'')',
      target_table
    );
  end loop;

  foreach target_table in array team_tables loop
    execute format(
      'drop trigger if exists livecoach_apply_scope on public.%I',
      target_table
    );
    execute format(
      'create trigger livecoach_apply_scope before insert on public.%I for each row execute function public.apply_livecoach_record_scope(''team'')',
      target_table
    );
  end loop;

  foreach target_table in array private_tables || team_tables loop
    execute format(
      'drop trigger if exists livecoach_protect_scope on public.%I',
      target_table
    );
    execute format(
      'create trigger livecoach_protect_scope before update of workspace_id, owner_id, visibility on public.%I for each row execute function public.protect_livecoach_record_scope()',
      target_table
    );
    execute format(
      'drop trigger if exists livecoach_audit_scope on public.%I',
      target_table
    );
    execute format(
      'create trigger livecoach_audit_scope after update of workspace_id, owner_id, visibility on public.%I for each row execute function public.audit_livecoach_record_scope()',
      target_table
    );
    execute format(
      'alter table public.%I alter column workspace_id set not null, alter column owner_id set not null, alter column visibility set not null',
      target_table
    );
    execute format(
      'alter table public.%I validate constraint %I',
      target_table,
      target_table || '_workspace_id_fkey'
    );
    execute format(
      'alter table public.%I validate constraint %I',
      target_table,
      target_table || '_owner_id_fkey'
    );
    execute format(
      'alter table public.%I validate constraint %I',
      target_table,
      target_table || '_visibility_check'
    );
  end loop;
end
$$;

-- Membership rows are readable only by the member themselves. All privileged
-- membership and invitation changes continue through trusted server routes.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.access_audit_events enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.workspace_invitations from anon, authenticated;
revoke all on public.access_audit_events from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, insert on public.access_audit_events to authenticated;
grant all on public.profiles, public.workspaces, public.workspace_members,
  public.workspace_invitations, public.access_audit_events to service_role;

drop policy if exists "Users read their own profile" on public.profiles;
create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Members read their workspace" on public.workspaces;
create policy "Members read their workspace"
  on public.workspaces for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

drop policy if exists "Members read their own membership" on public.workspace_members;
create policy "Members read their own membership"
  on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Owners read workspace access audit" on public.access_audit_events;
create policy "Owners read workspace access audit"
  on public.access_audit_events for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = access_audit_events.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

drop policy if exists "Members append their access audit" on public.access_audit_events;
create policy "Members append their access audit"
  on public.access_audit_events for insert to authenticated
  with check (
    actor_user_id = (select auth.uid())
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = access_audit_events.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

-- These server-internal tables contain credentials, global cache entries or
-- privileged processing state. They remain unavailable through the end-user
-- Data API even though their rows now carry an owner and workspace.
revoke all on public.google_oauth from anon, authenticated;
revoke all on public.ai_cache from anon, authenticated;
revoke all on public.app_config from anon, authenticated;
revoke all on public.contact_company_overrides from anon, authenticated;
revoke all on public.opportunity_signal_receipts from anon, authenticated;
revoke all on public.workspace_invitations from anon, authenticated;

-- All user-facing record tables share one policy shape. Private rows are owner
-- only. Team rows are visible to active members of the same workspace.
do $$
declare
  target_table text;
  user_record_tables text[] := array[
    'assistant_messages',
    'call_feedback',
    'client_context',
    'coaching_points',
    'companies',
    'company_priority',
    'contacts',
    'crm_company_redirects',
    'daily_briefs',
    'departments',
    'document_jobs',
    'external_refs',
    'field_definitions',
    'follow_ups',
    'interview_sessions',
    'interview_summaries',
    'knowledge_base',
    'knowledge_docs',
    'lessons',
    'meet_bots',
    'meet_utterances',
    'opportunities',
    'opportunity_events',
    'outreach_campaigns',
    'outreach_enrolments',
    'outreach_events',
    'outreach_learnings',
    'outreach_messages',
    'outreach_prospects',
    'outreach_signals',
    'outreach_suppressions',
    'tasks',
    'upcoming_calls',
    'usage_log',
    'workspace_profile',
    'workstream_contacts',
    'workstreams'
  ];
begin
  foreach target_table in array user_record_tables loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('revoke all on public.%I from anon, authenticated', target_table);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      target_table
    );

    execute format(
      'drop policy if exists "Members read permitted records" on public.%I',
      target_table
    );
    execute format(
      'create policy "Members read permitted records" on public.%1$I for select to authenticated using (
        owner_id = (select auth.uid())
        or (
          visibility = ''team''
          and exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = %1$I.workspace_id
              and wm.user_id = (select auth.uid())
              and wm.status = ''active''
          )
        )
      )',
      target_table
    );

    execute format(
      'drop policy if exists "Members create records in their workspace" on public.%I',
      target_table
    );
    execute format(
      'create policy "Members create records in their workspace" on public.%1$I for insert to authenticated with check (
        owner_id = (select auth.uid())
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = %1$I.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.status = ''active''
        )
      )',
      target_table
    );

    execute format(
      'drop policy if exists "Members update permitted records" on public.%I',
      target_table
    );
    execute format(
      'create policy "Members update permitted records" on public.%1$I for update to authenticated using (
        owner_id = (select auth.uid())
        or (
          visibility = ''team''
          and exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = %1$I.workspace_id
              and wm.user_id = (select auth.uid())
              and wm.status = ''active''
          )
        )
      ) with check (
        exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = %1$I.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.status = ''active''
        )
        and (
          visibility = ''team''
          or owner_id = (select auth.uid())
        )
      )',
      target_table
    );

    execute format(
      'drop policy if exists "Owners delete permitted records" on public.%I',
      target_table
    );
    execute format(
      'create policy "Owners delete permitted records" on public.%1$I for delete to authenticated using (
        owner_id = (select auth.uid())
        or (
          visibility = ''team''
          and exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = %1$I.workspace_id
              and wm.user_id = (select auth.uid())
              and wm.status = ''active''
              and wm.role in (''owner'', ''manager'')
          )
        )
      )',
      target_table
    );
  end loop;
end
$$;

-- The historical function is trigger-only. It must not remain callable as a
-- privileged public RPC once additional accounts exist.
do $$
begin
  if to_regprocedure('public.close_meet_bots_on_summary()') is not null then
    revoke execute on function public.close_meet_bots_on_summary()
      from public, anon, authenticated;
    grant execute on function public.close_meet_bots_on_summary()
      to service_role;
  end if;
end
$$;

revoke execute on function public.apply_livecoach_record_scope()
  from public, anon, authenticated;
revoke execute on function public.protect_livecoach_record_scope()
  from public, anon, authenticated;
revoke execute on function public.audit_livecoach_record_scope()
  from public, anon, authenticated;

comment on table public.workspaces is
  'A company-level LiveCoach workspace. User membership does not grant access to private rows.';
comment on table public.workspace_members is
  'Invite-only workspace membership and business role. Authorization does not use user-editable profile metadata.';
comment on column public.companies.visibility is
  'Private means owner-only. Team means any active member of the same workspace can read the record.';
comment on table public.access_audit_events is
  'Append-only evidence of ownership and visibility changes.';
