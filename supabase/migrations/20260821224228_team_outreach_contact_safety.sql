-- Outreach is shared by a workspace, so recipient safety must also be shared.
-- These columns are safety snapshots derived from the canonical prospect.
-- Active records follow corrections, while sent and completed records remain
-- frozen as evidence of what was actually used. They let Postgres reject
-- cross-campaign and cross-sender races without creating another contact store.

alter table public.outreach_enrolments
  add column if not exists recipient_email text,
  add column if not exists company_key text,
  add column if not exists cooldown_override_at timestamptz,
  add column if not exists cooldown_override_by uuid,
  add column if not exists cooldown_override_reason text;

alter table public.outreach_messages
  add column if not exists recipient_email text,
  add column if not exists company_key text,
  add column if not exists delivery_day date,
  add column if not exists claim_expires_at timestamptz;

alter table public.outreach_messages
  drop constraint if exists outreach_messages_status_check;
alter table public.outreach_messages
  add constraint outreach_messages_status_check check (
    status in ('draft', 'approved', 'sending', 'sent', 'failed', 'cancelled')
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outreach_enrolments_cooldown_override_by_fkey'
      and conrelid = 'public.outreach_enrolments'::regclass
  ) then
    alter table public.outreach_enrolments
      add constraint outreach_enrolments_cooldown_override_by_fkey
      foreign key (cooldown_override_by) references auth.users(id)
      on delete restrict not valid;
  end if;
end
$$;

alter table public.outreach_enrolments
  drop constraint if exists outreach_enrolments_cooldown_override_complete;
alter table public.outreach_enrolments
  add constraint outreach_enrolments_cooldown_override_complete check (
    (
      cooldown_override_at is null
      and cooldown_override_by is null
      and cooldown_override_reason is null
    )
    or (
      cooldown_override_at is not null
      and cooldown_override_by is not null
      and char_length(trim(coalesce(cooldown_override_reason, ''))) between 10 and 500
    )
  ) not valid;

create or replace function public.outreach_company_safety_key(
  company_domain text,
  crm_company_id uuid,
  company_name text,
  email text
)
returns text
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  normalised_domain text;
  normalised_email text;
  email_domain text;
  normalised_name text;
begin
  normalised_domain := lower(trim(coalesce(company_domain, '')));
  normalised_domain := regexp_replace(normalised_domain, '^https?://', '');
  normalised_domain := regexp_replace(normalised_domain, '^www\.', '');
  normalised_domain := split_part(normalised_domain, '/', 1);
  normalised_domain := split_part(normalised_domain, ':', 1);

  if normalised_domain <> '' then
    return 'domain:' || normalised_domain;
  end if;

  normalised_email := lower(trim(coalesce(email, '')));
  email_domain := split_part(normalised_email, '@', 2);
  if email_domain <> '' and email_domain not in (
    'aol.com', 'gmail.com', 'googlemail.com', 'hotmail.co.uk', 'hotmail.com',
    'icloud.com', 'live.co.uk', 'live.com', 'me.com', 'msn.com',
    'outlook.com', 'proton.me', 'protonmail.com', 'yahoo.co.uk', 'yahoo.com'
  ) then
    return 'domain:' || email_domain;
  end if;

  if crm_company_id is not null then
    return 'crm:' || crm_company_id::text;
  end if;

  normalised_name := regexp_replace(
    lower(trim(coalesce(company_name, ''))),
    '[^a-z0-9]+',
    '',
    'g'
  );
  if normalised_name <> '' then
    return 'name:' || normalised_name;
  end if;

  if normalised_email <> '' then
    return 'contact:' || normalised_email;
  end if;

  return null;
end
$$;

create or replace function public.apply_outreach_enrolment_team_safety()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  prospect_row public.outreach_prospects%rowtype;
  override_is_allowed boolean := false;
  cooldown_conflict record;
begin
  select * into prospect_row
  from public.outreach_prospects
  where id = new.prospect_id;

  if prospect_row.id is null then
    raise exception 'The outreach contact no longer exists';
  end if;
  if new.workspace_id is distinct from prospect_row.workspace_id then
    raise exception 'The campaign and contact must belong to the same workspace';
  end if;

  new.recipient_email := lower(trim(prospect_row.email));
  new.company_key := public.outreach_company_safety_key(
    prospect_row.company_domain,
    prospect_row.crm_company_id,
    prospect_row.company_name,
    prospect_row.email
  );

  if new.cooldown_override_at is not null
    or new.cooldown_override_by is not null
    or new.cooldown_override_reason is not null then
    select exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = new.workspace_id
        and wm.user_id = new.cooldown_override_by
        and wm.status = 'active'
        and wm.role in ('owner', 'manager')
    ) into override_is_allowed;

    if not override_is_allowed then
      raise exception 'Only an active workspace owner or manager can override the outreach cooldown';
    end if;
    if new.cooldown_override_at is null
      or new.cooldown_override_by is null
      or char_length(trim(coalesce(new.cooldown_override_reason, ''))) < 10 then
      raise exception 'A manager override needs a clear reason';
    end if;
  end if;

  if new.status in (
    'queued', 'researched', 'drafted', 'approved', 'contacted',
    'replied', 'booked', 'paused'
  ) then
    select e.id, e.campaign_id, e.status, e.last_sent_at
      into cooldown_conflict
    from public.outreach_enrolments e
    where e.workspace_id = new.workspace_id
      and e.prospect_id = new.prospect_id
      and e.id is distinct from new.id
      and e.campaign_id is distinct from new.campaign_id
      and e.last_sent_at > now() - interval '30 days'
    order by e.last_sent_at desc
    limit 1;

    if found and not override_is_allowed then
      raise exception using
        errcode = '23514',
        constraint = 'outreach_cross_campaign_cooldown',
        message = 'This person is inside the 30 day cross campaign safety pause';
    end if;
  end if;

  return new;
end
$$;

create or replace function public.apply_outreach_message_team_safety()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  prospect_row public.outreach_prospects%rowtype;
begin
  select * into prospect_row
  from public.outreach_prospects
  where id = new.prospect_id;

  if prospect_row.id is null then
    raise exception 'The outreach contact no longer exists';
  end if;
  if new.workspace_id is distinct from prospect_row.workspace_id then
    raise exception 'The email and contact must belong to the same workspace';
  end if;

  new.recipient_email := lower(trim(prospect_row.email));
  new.company_key := public.outreach_company_safety_key(
    prospect_row.company_domain,
    prospect_row.crm_company_id,
    prospect_row.company_name,
    prospect_row.email
  );

  if new.status = 'sent' then
    new.delivery_day := coalesce(
      new.delivery_day,
      (coalesce(new.sent_at, now()) at time zone 'Europe/London')::date
    );
    new.claim_expires_at := null;
  elsif new.status in ('approved', 'sending') and new.scheduled_at is not null then
    new.delivery_day := (new.scheduled_at at time zone 'Europe/London')::date;
  else
    new.delivery_day := null;
    new.claim_expires_at := null;
  end if;

  return new;
end
$$;

-- Backfill the safety snapshots before creating the unique guards. The live
-- preflight confirmed there are no conflicting rows, so this preserves every
-- existing enrolment, message and event.
update public.outreach_enrolments e
set
  recipient_email = lower(trim(p.email)),
  company_key = public.outreach_company_safety_key(
    p.company_domain,
    p.crm_company_id,
    p.company_name,
    p.email
  )
from public.outreach_prospects p
where p.id = e.prospect_id;

update public.outreach_messages m
set
  recipient_email = lower(trim(p.email)),
  company_key = public.outreach_company_safety_key(
    p.company_domain,
    p.crm_company_id,
    p.company_name,
    p.email
  ),
  delivery_day = case
    when m.status = 'sent' then
      (coalesce(m.sent_at, m.scheduled_at, m.updated_at) at time zone 'Europe/London')::date
    when m.status = 'approved' and m.scheduled_at is not null then
      (m.scheduled_at at time zone 'Europe/London')::date
    else null
  end
from public.outreach_prospects p
where p.id = m.prospect_id;

drop trigger if exists outreach_enrolments_apply_team_safety
  on public.outreach_enrolments;
create trigger outreach_enrolments_apply_team_safety
  before insert or update of
    prospect_id, campaign_id, status, queued_for, workspace_id,
    recipient_email, company_key, cooldown_override_at,
    cooldown_override_by, cooldown_override_reason
  on public.outreach_enrolments
  for each row execute function public.apply_outreach_enrolment_team_safety();

drop trigger if exists outreach_messages_apply_team_safety
  on public.outreach_messages;
create trigger outreach_messages_apply_team_safety
  before insert or update of
    prospect_id, status, scheduled_at, sent_at, workspace_id,
    recipient_email, company_key, delivery_day
  on public.outreach_messages
  for each row execute function public.apply_outreach_message_team_safety();

create unique index if not exists outreach_one_active_campaign_per_contact
  on public.outreach_enrolments (workspace_id, prospect_id)
  where status in (
    'queued', 'researched', 'drafted', 'approved', 'contacted',
    'replied', 'booked', 'paused'
  );

create unique index if not exists outreach_one_company_per_queue_day
  on public.outreach_enrolments (workspace_id, company_key, queued_for)
  where company_key is not null
    and queued_for is not null
    and status <> 'suppressed';

create unique index if not exists outreach_one_approved_message_per_contact
  on public.outreach_messages (workspace_id, prospect_id)
  where status in ('approved', 'sending');

create unique index if not exists outreach_one_recipient_per_delivery_day
  on public.outreach_messages (workspace_id, recipient_email, delivery_day)
  where recipient_email is not null
    and delivery_day is not null
    and status in ('approved', 'sending', 'sent');

create unique index if not exists outreach_one_company_per_delivery_day
  on public.outreach_messages (workspace_id, company_key, delivery_day)
  where company_key is not null
    and delivery_day is not null
    and status in ('approved', 'sending', 'sent');

create unique index if not exists outreach_one_sender_per_send_slot
  on public.outreach_messages (sender_user_id, scheduled_at)
  where sender_user_id is not null
    and scheduled_at is not null
    and status = 'approved';

create index if not exists outreach_enrolments_cooldown_override_by_idx
  on public.outreach_enrolments (cooldown_override_by)
  where cooldown_override_by is not null;

create index if not exists outreach_messages_available_claim_idx
  on public.outreach_messages (sender_user_id, scheduled_at, claim_expires_at)
  where status = 'approved' and scheduled_at is not null;

create or replace function public.sync_outreach_safety_identity_from_prospect()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_email text;
  next_company_key text;
begin
  next_email := lower(trim(new.email));
  next_company_key := public.outreach_company_safety_key(
    new.company_domain,
    new.crm_company_id,
    new.company_name,
    new.email
  );

  -- Active records follow the corrected canonical identity. Completed history
  -- keeps the identity that was used at the time.
  update public.outreach_enrolments
  set recipient_email = next_email, company_key = next_company_key
  where prospect_id = new.id
    and status in (
      'queued', 'researched', 'drafted', 'approved', 'contacted',
      'replied', 'booked', 'paused'
    )
    and (
      recipient_email is distinct from next_email
      or company_key is distinct from next_company_key
    );

  update public.outreach_messages
  set recipient_email = next_email, company_key = next_company_key
  where prospect_id = new.id
    and status in ('draft', 'approved')
    and (
      recipient_email is distinct from next_email
      or company_key is distinct from next_company_key
    );

  return new;
end
$$;

drop trigger if exists outreach_prospects_sync_team_safety
  on public.outreach_prospects;
create trigger outreach_prospects_sync_team_safety
  after update of email, company_domain, company_name, crm_company_id
  on public.outreach_prospects
  for each row execute function public.sync_outreach_safety_identity_from_prospect();

create or replace function public.protect_outreach_message_in_flight()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status = 'sending' and new.status not in ('sent', 'failed') then
    raise exception 'An outreach email being delivered cannot be changed or requeued';
  end if;
  return new;
end
$$;

drop trigger if exists outreach_messages_protect_in_flight
  on public.outreach_messages;
create trigger outreach_messages_protect_in_flight
  before update on public.outreach_messages
  for each row execute function public.protect_outreach_message_in_flight();

revoke execute on function public.protect_outreach_message_in_flight()
  from public, anon, authenticated;

alter table public.outreach_events
  drop constraint if exists outreach_events_kind_check;
alter table public.outreach_events
  add constraint outreach_events_kind_check check (kind in (
    'queued', 'researched', 'drafted', 'approved', 'sent', 'reply',
    'positive_reply', 'objection', 'later', 'referral', 'unsubscribe',
    'meeting_booked', 'booking_link_shared', 'crm_created',
    'learning_promoted', 'safety_override', 'failed'
  ));

create or replace function public.audit_outreach_cooldown_override()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  should_audit boolean := false;
begin
  if new.cooldown_override_at is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    should_audit := true;
  elsif tg_op = 'UPDATE' then
    should_audit :=
      new.cooldown_override_at is distinct from old.cooldown_override_at
      or new.cooldown_override_by is distinct from old.cooldown_override_by
      or new.cooldown_override_reason is distinct from old.cooldown_override_reason;
  end if;

  if should_audit then
    insert into public.outreach_events (
      workspace_id,
      owner_id,
      visibility,
      campaign_id,
      prospect_id,
      kind,
      metadata
    ) values (
      new.workspace_id,
      new.cooldown_override_by,
      'team',
      new.campaign_id,
      new.prospect_id,
      'safety_override',
      jsonb_build_object(
        'reason', new.cooldown_override_reason,
        'overrideAt', new.cooldown_override_at,
        'overrideBy', new.cooldown_override_by,
        'rule', '30_day_cross_campaign_cooldown'
      )
    );
  end if;
  return new;
end
$$;

drop trigger if exists outreach_enrolments_audit_cooldown_override
  on public.outreach_enrolments;
create trigger outreach_enrolments_audit_cooldown_override
  after insert or update of
    cooldown_override_at, cooldown_override_by, cooldown_override_reason
  on public.outreach_enrolments
  for each row execute function public.audit_outreach_cooldown_override();

alter table public.outreach_enrolments
  validate constraint outreach_enrolments_cooldown_override_by_fkey;
alter table public.outreach_enrolments
  validate constraint outreach_enrolments_cooldown_override_complete;

comment on column public.outreach_enrolments.company_key is
  'Derived workspace safety key used to prevent two teammates queueing the same company on one day.';
comment on column public.outreach_enrolments.cooldown_override_reason is
  'Audited manager reason for bypassing only the 30 day cross campaign cooldown. It never bypasses active-contact or same-day company locks.';
comment on column public.outreach_messages.delivery_day is
  'London calendar day reserved for this approved or sent email across the whole workspace.';
comment on column public.outreach_messages.claim_expires_at is
  'Short worker visibility timeout. It prevents overlapping cron workers sending the same approved message.';
