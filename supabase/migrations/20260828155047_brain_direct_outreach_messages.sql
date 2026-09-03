-- Keep one-off Brain emails in the canonical outreach ledger without forcing
-- them into an invented campaign or sequence. Existing campaign messages keep
-- their current relationship guarantees and remain unchanged.
alter table public.outreach_messages
  add column if not exists message_source text not null default 'campaign',
  add column if not exists request_key text,
  alter column campaign_id drop not null,
  alter column enrolment_id drop not null;

alter table public.outreach_messages
  drop constraint if exists outreach_messages_message_source_check,
  add constraint outreach_messages_message_source_check
    check (message_source in ('campaign', 'brain_direct')) not valid,
  drop constraint if exists outreach_messages_source_relationship_check,
  add constraint outreach_messages_source_relationship_check
    check (
      (
        message_source = 'campaign'
        and campaign_id is not null
        and enrolment_id is not null
      )
      or (
        message_source = 'brain_direct'
        and campaign_id is null
        and enrolment_id is null
      )
    ) not valid;

alter table public.outreach_messages
  validate constraint outreach_messages_message_source_check;
alter table public.outreach_messages
  validate constraint outreach_messages_source_relationship_check;

create unique index if not exists outreach_messages_sender_request_key_unique
  on public.outreach_messages (sender_user_id, request_key)
  where request_key is not null;

create index if not exists outreach_messages_sender_recent_activity_idx
  on public.outreach_messages (workspace_id, sender_user_id, updated_at desc);

comment on column public.outreach_messages.message_source is
  'campaign for sequence email, brain_direct for a separately confirmed one-off Brain email';
comment on column public.outreach_messages.request_key is
  'Sender-scoped idempotency key for retry-safe creation from an approved Brain action';

-- A prospect must always belong to the same workspace. Campaign and enrolment
-- checks remain mandatory for sequence mail, while one-off Brain mail must have
-- neither relationship.
create or replace function public.validate_outreach_relationship_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  workspace_value uuid := nullif(to_jsonb(new)->>'workspace_id', '')::uuid;
  campaign_value uuid := nullif(to_jsonb(new)->>'campaign_id', '')::uuid;
  prospect_value uuid := nullif(to_jsonb(new)->>'prospect_id', '')::uuid;
  enrolment_value uuid := nullif(to_jsonb(new)->>'enrolment_id', '')::uuid;
  message_source_value text := coalesce(
    nullif(to_jsonb(new)->>'message_source', ''),
    'campaign'
  );
begin
  if not exists (
    select 1
    from public.outreach_prospects p
    where p.id = prospect_value
      and p.workspace_id = workspace_value
  ) then
    raise exception 'The outreach contact belongs to a different workspace';
  end if;

  if tg_table_name = 'outreach_enrolments' then
    if not exists (
      select 1
      from public.outreach_campaigns c
      where c.id = campaign_value
        and c.workspace_id = workspace_value
    ) then
      raise exception 'The outreach campaign belongs to a different workspace';
    end if;
    return new;
  end if;

  if message_source_value = 'brain_direct' then
    if campaign_value is not null or enrolment_value is not null then
      raise exception 'A direct Brain email cannot be attached to a campaign enrolment';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.outreach_campaigns c
    where c.id = campaign_value
      and c.workspace_id = workspace_value
  ) then
    raise exception 'The outreach campaign belongs to a different workspace';
  end if;

  if not exists (
    select 1
    from public.outreach_enrolments e
    where e.id = enrolment_value
      and e.workspace_id = workspace_value
      and e.campaign_id = campaign_value
      and e.prospect_id = prospect_value
  ) then
    raise exception 'The outreach email does not match its campaign enrolment';
  end if;

  return new;
end
$$;

drop trigger if exists outreach_messages_validate_relationship_scope
  on public.outreach_messages;
create trigger outreach_messages_validate_relationship_scope
  before insert or update of
    workspace_id, enrolment_id, campaign_id, prospect_id, message_source
  on public.outreach_messages
  for each row execute function public.validate_outreach_relationship_scope();

revoke execute on function public.validate_outreach_relationship_scope()
  from public, anon, authenticated;
