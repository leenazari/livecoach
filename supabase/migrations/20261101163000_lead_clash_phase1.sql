-- Phase 1 lead-clash warning.
-- Additive only. The feature stays off until a workspace owner sets
-- lead_clash_settings.enabled. Existing company, contact, sync and merge
-- behaviour is unchanged while that flag is false or this migration has
-- not been applied. This file does not update or delete CRM rows.

create table if not exists public.lead_clash_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.lead_clash_settings is
  'Per-workspace kill switch for lead-clash checks. Missing or false means current CRM behaviour.';

create table if not exists public.lead_clash_exclusions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid,
  domain text,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint lead_clash_exclusions_target check (
    company_id is not null or nullif(btrim(coalesce(domain, '')), '') is not null
  )
);

create index if not exists lead_clash_exclusions_workspace_idx
  on public.lead_clash_exclusions (workspace_id, domain);

create table if not exists public.lead_clashes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  detected_at timestamptz not null default now(),
  trigger text not null,
  actor_user_id uuid not null,
  other_user_id uuid not null,
  company_id uuid,
  other_company_id uuid,
  match_type text not null,
  match_value text,
  disposition text not null default 'clash',
  resolution text not null default 'open',
  resolution_reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  constraint lead_clashes_match_type_check check (
    match_type in ('person', 'domain', 'name')
  ),
  constraint lead_clashes_disposition_check check (
    disposition in ('clash', 'shared')
  ),
  constraint lead_clashes_resolution_check check (
    resolution in (
      'open', 'proceeded', 'handed_over', 'department_split',
      'merged', 'dismissed', 'shared'
    )
  )
);

create index if not exists lead_clashes_workspace_detected_idx
  on public.lead_clashes (workspace_id, detected_at desc);

create table if not exists public.crm_company_merge_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  keep_id uuid not null,
  merge_id uuid not null,
  keep_owner_before uuid,
  merge_owner_before uuid,
  requested_keep_owner_id uuid,
  before_keep jsonb not null,
  before_merge jsonb not null,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.crm_company_merge_audit is
  'Before-state of both company rows for a cross-owner merge. The merge itself stays irreversible; this snapshot is for a manual restore.';

alter table public.lead_clash_settings enable row level security;
alter table public.lead_clash_exclusions enable row level security;
alter table public.lead_clashes enable row level security;
alter table public.crm_company_merge_audit enable row level security;

revoke all on table public.lead_clash_settings from public, anon, authenticated;
revoke all on table public.lead_clash_exclusions from public, anon, authenticated;
revoke all on table public.lead_clashes from public, anon, authenticated;
revoke all on table public.crm_company_merge_audit from public, anon, authenticated;

grant select, insert, update on table public.lead_clash_settings to authenticated;
grant select, insert, delete on table public.lead_clash_exclusions to authenticated;
grant select on table public.lead_clashes to authenticated;
grant select on table public.crm_company_merge_audit to authenticated;
grant all on table public.lead_clash_settings to service_role;
grant all on table public.lead_clash_exclusions to service_role;
grant all on table public.lead_clashes to service_role;
grant all on table public.crm_company_merge_audit to service_role;

create policy "Members read their lead clash switch"
  on public.lead_clash_settings for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lead_clash_settings.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
    )
  );

create policy "Owners and managers set the lead clash switch"
  on public.lead_clash_settings for insert to authenticated
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lead_clash_settings.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

create policy "Owners and managers update the lead clash switch"
  on public.lead_clash_settings for update to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lead_clash_settings.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lead_clash_settings.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

create policy "Owners and managers read lead clash exclusions"
  on public.lead_clash_exclusions for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lead_clash_exclusions.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

create policy "Owners and managers add lead clash exclusions"
  on public.lead_clash_exclusions for insert to authenticated
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lead_clash_exclusions.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

create policy "Owners and managers remove lead clash exclusions"
  on public.lead_clash_exclusions for delete to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lead_clash_exclusions.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

create policy "Owners and managers read lead clash log"
  on public.lead_clashes for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = lead_clashes.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

create policy "Owners and managers read merge audit"
  on public.crm_company_merge_audit for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = crm_company_merge_audit.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    )
  );

-- Notification kinds gain one value. Existing rows stay valid.
alter table public.crm_notifications
  drop constraint if exists crm_notifications_kind_check,
  add constraint crm_notifications_kind_check check (
    kind in (
      'outreach_reply', 'important_email', 'lead_assigned', 'chat_message',
      'work_assigned', 'lead_clash'
    )
  ),
  drop constraint if exists crm_notifications_source_table_check,
  add constraint crm_notifications_source_table_check check (
    source_table in (
      'outreach_prospects', 'opportunities', 'companies', 'crm_chat_messages',
      'tasks', 'lead_clashes'
    )
  );

create or replace function public.lead_clash_domain(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    pg_catalog.split_part(
      pg_catalog.split_part(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.btrim(coalesce(value, ''))),
            '^https?://',
            ''
          ),
          '^www\.',
          ''
        ),
        '/',
        1
      ),
      ':',
      1
    ),
    ''
  );
$$;

create or replace function public.lead_clash_domain_excluded(value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select public.lead_clash_domain(value) is null
    or public.lead_clash_domain(value) in (
      'aol.com', 'gmail.com', 'googlemail.com', 'hotmail.co.uk', 'hotmail.com',
      'icloud.com', 'live.co.uk', 'live.com', 'me.com', 'msn.com',
      'outlook.co.uk', 'outlook.com', 'proton.me', 'protonmail.com',
      'yahoo.co.uk', 'yahoo.com', 'ai13.com', 'interviewa.com'
    );
$$;

create or replace function public.lead_clash_name_key(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    pg_catalog.replace(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              pg_catalog.lower(coalesce(value, '')),
              '&',
              ' and ',
              'g'
            ),
            '\m(limited|ltd|incorporated|inc|llc|plc|company|co)\M',
            ' ',
            'g'
          ),
          '[^a-z0-9]+',
          ' ',
          'g'
        )
      ),
      ' ',
      ''
    ),
    ''
  );
$$;

create or replace function public.lead_clash_possible_name_key(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    pg_catalog.replace(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              pg_catalog.lower(coalesce(value, '')),
              '&',
              ' and ',
              'g'
            ),
            '\m(limited|ltd|incorporated|inc|llc|plc|company|co|group|uk)\M',
            ' ',
            'g'
          ),
          '[^a-z0-9]+',
          ' ',
          'g'
        )
      ),
      ' ',
      ''
    ),
    ''
  );
$$;

create or replace function public.lead_clash_linkedin_slug(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    pg_catalog.lower(
      (pg_catalog.regexp_match(
        pg_catalog.lower(coalesce(value, '')),
        'linkedin\.com/in/([^/?#]+)'
      ))[1]
    ),
    ''
  );
$$;

create or replace function public.lead_clash_contact_label(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when pg_catalog.btrim(coalesce(value, '')) = '' then null
    when pg_catalog.strpos(pg_catalog.btrim(value), ' ') = 0
      then pg_catalog.left(pg_catalog.btrim(value), 40)
    else pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(value), ' ', 1), 40)
      || ' '
      || pg_catalog.upper(pg_catalog.left(
        pg_catalog.reverse(pg_catalog.split_part(pg_catalog.reverse(pg_catalog.btrim(value)), ' ', 1)),
        1
      ))
      || '.'
  end;
$$;

create or replace function public.lead_clash_check(
  p_workspace uuid,
  p_name text default null,
  p_domain text default null,
  p_emails text[] default null,
  p_linkedin text[] default null,
  p_exclude_company uuid default null,
  p_exclude_contact uuid default null,
  p_actor_user_id uuid default null,
  p_attendee_emails text[] default null,
  p_external_ids text[] default null,
  p_meeting_urls text[] default null
)
returns table (
  other_user_id uuid,
  other_display_name text,
  company_name text,
  contact_label text,
  last_touch_at timestamptz,
  last_touch_kind text,
  next_touch_at timestamptz,
  match_type text,
  match_value text,
  other_company_id uuid,
  confidential boolean,
  disposition text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_enabled boolean;
begin
  if p_workspace is null then
    return;
  end if;

  v_actor := auth.uid();
  if p_actor_user_id is not null then
    if v_actor is not null and v_actor is distinct from p_actor_user_id then
      raise exception 'lead_clash_actor_mismatch' using errcode = '42501';
    end if;
    if v_actor is null then
      v_actor := p_actor_user_id;
    end if;
  end if;

  if v_actor is null or not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace
      and wm.user_id = v_actor
      and wm.status = 'active'
  ) then
    raise exception 'lead_clash_not_a_member' using errcode = '42501';
  end if;

  -- Default off. A direct RPC call returns nothing until an owner enables it.
  select s.enabled into v_enabled
  from public.lead_clash_settings s
  where s.workspace_id = p_workspace;
  if coalesce(v_enabled, false) is distinct from true then
    return;
  end if;

  return query
  with email_rows as (
    select pg_catalog.lower(pg_catalog.btrim(item.email)) as email
    from pg_catalog.unnest(coalesce(p_emails, array[]::text[])) as item(email)
    where pg_catalog.strpos(pg_catalog.btrim(item.email), '@') > 1
  ),
  domains as (
    select public.lead_clash_domain(p_domain) as domain
    where public.lead_clash_domain(p_domain) is not null
      and not public.lead_clash_domain_excluded(p_domain)
    union
    select public.lead_clash_domain(pg_catalog.split_part(email, '@', 2))
    from email_rows
    where not public.lead_clash_domain_excluded(pg_catalog.split_part(email, '@', 2))
  ),
  linkedin as (
    select public.lead_clash_linkedin_slug(item.value) as slug
    from pg_catalog.unnest(coalesce(p_linkedin, array[]::text[])) as item(value)
    where public.lead_clash_linkedin_slug(item.value) is not null
  ),
  names as (
    select
      public.lead_clash_name_key(p_name) as exact_key,
      public.lead_clash_possible_name_key(p_name) as possible_key
  ),
  company_rows as (
    select
      c.id,
      c.owner_id,
      c.name,
      c.is_confidential,
      c.updated_at,
      c.profile,
      public.lead_clash_domain(coalesce(nullif(pg_catalog.btrim(c.domain), ''), c.website)) as domain_key,
      public.lead_clash_name_key(c.name) as exact_key,
      public.lead_clash_possible_name_key(c.name) as possible_key
    from public.companies c
    where c.workspace_id = p_workspace
      and c.owner_id is distinct from v_actor
      and (p_exclude_company is null or c.id <> p_exclude_company)
      and coalesce(c.profile->>'lead_clash_exclude', '') not in ('true', '1', 'yes')
      and c.name !~* '^(test|internal)([[:space:]-]|$)'
      and not exists (
        select 1
        from public.lead_clash_exclusions ex
        where ex.workspace_id = p_workspace
          and (
            ex.company_id = c.id
            or (
              nullif(pg_catalog.btrim(coalesce(ex.domain, '')), '') is not null
              and ex.domain = public.lead_clash_domain(coalesce(c.domain, c.website))
            )
          )
      )
  ),
  alias_keys as (
    select cr.id, public.lead_clash_name_key(alias_value) as exact_key
    from company_rows cr
    cross join lateral pg_catalog.jsonb_array_elements_text(
      case
        when pg_catalog.jsonb_typeof(cr.profile->'aliases') = 'array' then cr.profile->'aliases'
        else '[]'::jsonb
      end
    ) as alias_row(alias_value)
  ),
  contact_rows as (
    select
      ct.company_id,
      ct.name,
      pg_catalog.lower(pg_catalog.btrim(coalesce(ct.email, ''))) as email,
      public.lead_clash_domain(pg_catalog.split_part(coalesce(ct.email, ''), '@', 2)) as email_domain,
      public.lead_clash_linkedin_slug(coalesce(
        ct.attributes->>'person_linkedin_url',
        ct.attributes->>'linkedin_url',
        ct.attributes->>'linkedin'
      )) as slug
    from public.contacts ct
    join company_rows cr on cr.id = ct.company_id
    where ct.workspace_id = p_workspace
      and (p_exclude_contact is null or ct.id <> p_exclude_contact)
  ),
  hits as (
    select cr.id, 'person'::text as match_type, 'email'::text as match_value, 1 as rank, ct.name as contact_name
    from company_rows cr
    join contact_rows ct on ct.company_id = cr.id
    join email_rows er on er.email = ct.email and ct.email <> ''
    union all
    select cr.id, 'person', 'linkedin', 1, ct.name
    from company_rows cr
    join contact_rows ct on ct.company_id = cr.id
    join linkedin li on li.slug <> '' and li.slug = ct.slug
    union all
    select cr.id, 'domain', cr.domain_key, 2, null::text
    from company_rows cr
    join domains d on d.domain = cr.domain_key
    where cr.domain_key is not null
      and not public.lead_clash_domain_excluded(cr.domain_key)
    union all
    select cr.id, 'domain', ct.email_domain, 2, ct.name
    from company_rows cr
    join contact_rows ct on ct.company_id = cr.id
    join domains d on d.domain = ct.email_domain
    where ct.email_domain is not null
      and not public.lead_clash_domain_excluded(ct.email_domain)
    union all
    select cr.id, 'name', cr.exact_key, 3, null::text
    from company_rows cr
    join names n on n.exact_key = cr.exact_key
    where pg_catalog.length(coalesce(cr.exact_key, '')) >= 4
    union all
    select cr.id, 'name', alias_keys.exact_key, 3, null::text
    from company_rows cr
    join alias_keys on alias_keys.id = cr.id
    join names n on n.exact_key = alias_keys.exact_key
    where pg_catalog.length(coalesce(alias_keys.exact_key, '')) >= 4
    union all
    select cr.id, 'name', cr.possible_key, 3, null::text
    from company_rows cr
    join names n
      on n.possible_key = cr.possible_key
     and n.exact_key is distinct from cr.exact_key
    where pg_catalog.length(coalesce(cr.possible_key, '')) >= 4
      and pg_catalog.length(coalesce(n.possible_key, '')) >= 4
  ),
  best as (
    select distinct on (cr.owner_id)
      cr.owner_id,
      cr.id as company_id,
      cr.name as company_name,
      cr.is_confidential,
      cr.updated_at,
      hits.match_type,
      hits.match_value,
      hits.rank,
      hits.contact_name
    from hits
    join company_rows cr on cr.id = hits.id
    order by cr.owner_id, hits.rank asc, cr.updated_at desc nulls last
  ),
  shaped as (
    select
      best.owner_id as other_user_id,
      case
        when best.is_confidential then 'A colleague'
        else coalesce(nullif(pg_catalog.btrim(profile.display_name), ''), 'A teammate')
      end as other_display_name,
      case when best.is_confidential then null else pg_catalog.left(best.company_name, 160) end as company_name,
      case
        when best.is_confidential then null
        else public.lead_clash_contact_label(coalesce(
          best.contact_name,
          (
            select ct.name
            from contact_rows ct
            where ct.company_id = best.company_id
              and pg_catalog.btrim(coalesce(ct.name, '')) <> ''
            limit 1
          )
        ))
      end as contact_label,
      case
        when best.is_confidential then null
        else coalesce(touches.last_touch_at, best.updated_at)
      end as last_touch_at,
      case
        when best.is_confidential then null
        when touches.last_touch_at is not null then 'call'
        when best.updated_at is not null then 'record'
        else null
      end as last_touch_kind,
      case when best.is_confidential then null else touches.next_touch_at end as next_touch_at,
      best.match_type,
      case
        when best.is_confidential then null
        else pg_catalog.left(best.match_value, 120)
      end as match_value,
      best.company_id as other_company_id,
      best.is_confidential as confidential,
      case when shared.yes then 'shared' else 'clash' end as disposition,
      best.rank
    from best
    left join public.profiles profile on profile.user_id = best.owner_id
    left join lateral (
      select
        (
          select max(coalesce(
            call.completed_at,
            case when call.scheduled_at <= pg_catalog.now() then call.scheduled_at else null end
          ))
          from public.upcoming_calls call
          where call.workspace_id = p_workspace
            and call.owner_id = best.owner_id
            and call.company_id = best.company_id
        ) as last_touch_at,
        (
          select min(call.scheduled_at)
          from public.upcoming_calls call
          where call.workspace_id = p_workspace
            and call.owner_id = best.owner_id
            and call.company_id = best.company_id
            and call.completed_at is null
            and call.scheduled_at > pg_catalog.now()
        ) as next_touch_at
    ) as touches on true
    left join lateral (
      select exists (
        select 1
        from pg_catalog.unnest(coalesce(p_attendee_emails, array[]::text[])) as attendee(email)
        where nullif(pg_catalog.btrim(coalesce(profile.email, '')), '') is not null
          and pg_catalog.lower(pg_catalog.btrim(attendee.email)) = pg_catalog.lower(pg_catalog.btrim(profile.email))
      ) or exists (
        select 1
        from public.upcoming_calls theirs
        where theirs.workspace_id = p_workspace
          and theirs.owner_id = best.owner_id
          and (
            (
              nullif(pg_catalog.btrim(coalesce(theirs.external_id, '')), '') is not null
              and pg_catalog.lower(pg_catalog.btrim(theirs.external_id)) in (
                select pg_catalog.lower(pg_catalog.btrim(item.value))
                from pg_catalog.unnest(coalesce(p_external_ids, array[]::text[])) as item(value)
                where pg_catalog.btrim(item.value) <> ''
              )
            )
            or (
              nullif(pg_catalog.btrim(coalesce(theirs.meeting_url, '')), '') is not null
              and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(theirs.meeting_url)), '[?#].*$', '') in (
                select pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(item.value)), '[?#].*$', '')
                from pg_catalog.unnest(coalesce(p_meeting_urls, array[]::text[])) as item(value)
                where pg_catalog.btrim(item.value) <> ''
              )
            )
          )
      ) or exists (
        select 1
        from public.upcoming_calls mine
        join public.upcoming_calls theirs
          on theirs.workspace_id = mine.workspace_id
         and theirs.owner_id = best.owner_id
         and (
           (
             nullif(pg_catalog.btrim(coalesce(mine.external_id, '')), '') is not null
             and mine.external_id = theirs.external_id
           )
           or (
             nullif(pg_catalog.btrim(coalesce(mine.meeting_url, '')), '') is not null
             and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(mine.meeting_url)), '[?#].*$', '')
               = pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(theirs.meeting_url)), '[?#].*$', '')
           )
         )
        where mine.workspace_id = p_workspace
          and mine.owner_id = v_actor
          and (mine.company_id = best.company_id or theirs.company_id = best.company_id)
      ) as yes
    ) as shared on true
  )
  select
    shaped.other_user_id,
    shaped.other_display_name,
    shaped.company_name,
    shaped.contact_label,
    shaped.last_touch_at,
    shaped.last_touch_kind,
    shaped.next_touch_at,
    shaped.match_type,
    shaped.match_value,
    shaped.other_company_id,
    shaped.confidential,
    shaped.disposition
  from shaped
  order by shaped.rank asc, shaped.last_touch_at desc nulls last
  limit 5;
end;
$$;

revoke all on function public.lead_clash_domain(text) from public, anon, authenticated;
revoke all on function public.lead_clash_domain_excluded(text) from public, anon, authenticated;
revoke all on function public.lead_clash_name_key(text) from public, anon, authenticated;
revoke all on function public.lead_clash_possible_name_key(text) from public, anon, authenticated;
revoke all on function public.lead_clash_linkedin_slug(text) from public, anon, authenticated;
revoke all on function public.lead_clash_contact_label(text) from public, anon, authenticated;
revoke all on function public.lead_clash_check(
  uuid, text, text, text[], text[], uuid, uuid, uuid, text[], text[], text[]
) from public, anon;
grant execute on function public.lead_clash_check(
  uuid, text, text, text[], text[], uuid, uuid, uuid, text[], text[], text[]
) to authenticated, service_role;

comment on function public.lead_clash_check(
  uuid, text, text, text[], text[], uuid, uuid, uuid, text[], text[], text[]
) is
  'Returns at most five minimal cross-owner lead matches for an active workspace member. No notes, emails, deal values or message content. Returns no rows while lead_clash_settings.enabled is not true.';
