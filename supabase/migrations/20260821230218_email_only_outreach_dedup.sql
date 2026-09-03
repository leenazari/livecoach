-- Team outreach deduplication is intentionally based on the exact normalized
-- recipient email. Different people at one company must not block each other.
-- Existing company snapshots remain as historical metadata but are no longer
-- used as queue or delivery locks.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop index if exists public.outreach_one_company_per_queue_day;
drop index if exists public.outreach_one_company_per_delivery_day;

drop index if exists public.outreach_one_active_campaign_per_contact;
create unique index outreach_one_active_campaign_per_recipient_email
  on public.outreach_enrolments (workspace_id, recipient_email)
  where recipient_email is not null
    and status in (
      'queued', 'researched', 'drafted', 'approved', 'contacted',
      'replied', 'booked', 'paused'
    );

drop index if exists public.outreach_one_approved_message_per_contact;
create unique index outreach_one_approved_message_per_recipient_email
  on public.outreach_messages (workspace_id, recipient_email)
  where recipient_email is not null
    and status in ('approved', 'sending');

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
      and e.recipient_email = new.recipient_email
      and e.id is distinct from new.id
      and e.campaign_id is distinct from new.campaign_id
      and e.last_sent_at > now() - interval '30 days'
    order by e.last_sent_at desc
    limit 1;

    if found and not override_is_allowed then
      raise exception using
        errcode = '23514',
        constraint = 'outreach_cross_campaign_cooldown',
        message = 'This email address is inside the 30 day cross campaign safety pause';
    end if;
  end if;

  return new;
end
$$;

comment on column public.outreach_enrolments.company_key is
  'Derived company grouping metadata. Team outreach deduplication uses recipient_email, not this field.';
comment on column public.outreach_enrolments.cooldown_override_reason is
  'Audited manager reason for bypassing only the 30 day email cooldown. It never bypasses active-email or same-day recipient locks.';
comment on column public.outreach_messages.company_key is
  'Frozen company grouping metadata retained for audit. Delivery deduplication uses recipient_email.';
