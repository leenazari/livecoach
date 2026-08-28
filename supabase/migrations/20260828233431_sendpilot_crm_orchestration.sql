-- SendPilot remains the LinkedIn execution layer. These service-only tables
-- bind each salesperson's private SendPilot account to shared LiveCoach
-- campaigns and retain a canonical, idempotent link for every enrolled lead.

create table public.sendpilot_campaign_links (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  livecoach_campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  sendpilot_campaign_id text not null,
  sendpilot_campaign_name text not null,
  sendpilot_campaign_status text not null
    check (sendpilot_campaign_status in ('started', 'paused', 'draft', 'finished')),
  active boolean not null default false,
  last_refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sendpilot_campaign_links_integration_scope_fkey
    foreign key (integration_id, owner_id, workspace_id)
    references public.sendpilot_integrations(id, owner_id, workspace_id)
    on delete cascade,
  unique (integration_id, livecoach_campaign_id),
  unique (integration_id, sendpilot_campaign_id),
  unique (id, integration_id, owner_id, workspace_id)
);

create table public.sendpilot_lead_links (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  campaign_link_id uuid references public.sendpilot_campaign_links(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  outreach_prospect_id uuid not null references public.outreach_prospects(id) on delete cascade,
  outreach_enrolment_id uuid references public.outreach_enrolments(id) on delete set null,
  livecoach_campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  sendpilot_campaign_id text not null,
  sendpilot_campaign_name text,
  sendpilot_lead_id text,
  linkedin_url text not null,
  enrollment_request_id uuid,
  sync_status text not null default 'submitting' check (sync_status in (
    'submitting', 'pending_confirmation', 'queued', 'active', 'replied',
    'completed', 'failed', 'suppressed'
  )),
  external_status text,
  custom_lead_status text,
  last_event_type text,
  enrolled_at timestamptz,
  last_event_at timestamptz,
  last_message_at timestamptz,
  last_reply_at timestamptz,
  last_connection_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sendpilot_lead_links_integration_scope_fkey
    foreign key (integration_id, owner_id, workspace_id)
    references public.sendpilot_integrations(id, owner_id, workspace_id)
    on delete cascade,
  unique (integration_id, outreach_enrolment_id),
  unique (integration_id, enrollment_request_id)
);

create unique index sendpilot_lead_links_provider_lead_once_idx
  on public.sendpilot_lead_links (integration_id, sendpilot_lead_id)
  where sendpilot_lead_id is not null;

create unique index sendpilot_lead_links_active_linkedin_once_idx
  on public.sendpilot_lead_links (integration_id, linkedin_url)
  where sync_status in (
    'submitting', 'pending_confirmation', 'queued', 'active', 'replied', 'suppressed'
  );

create index sendpilot_campaign_links_owner_idx
  on public.sendpilot_campaign_links (workspace_id, owner_id, active);
create index sendpilot_lead_links_owner_status_idx
  on public.sendpilot_lead_links (workspace_id, owner_id, sync_status, updated_at desc);
create index sendpilot_lead_links_prospect_idx
  on public.sendpilot_lead_links (outreach_prospect_id, updated_at desc);
create index sendpilot_lead_links_enrolled_idx
  on public.sendpilot_lead_links (workspace_id, owner_id, enrolled_at)
  where enrolled_at is not null;

alter table public.sendpilot_webhook_events
  add column sendpilot_lead_link_id uuid
    references public.sendpilot_lead_links(id) on delete set null,
  add column linked_outreach_event_id uuid
    references public.outreach_events(id) on delete set null;

create index sendpilot_webhook_events_lead_link_idx
  on public.sendpilot_webhook_events (sendpilot_lead_link_id)
  where sendpilot_lead_link_id is not null;

create unique index outreach_sendpilot_provider_event_once_idx
  on public.outreach_events (
    workspace_id,
    owner_id,
    (metadata ->> 'providerEventId')
  )
  where metadata ->> 'provider' = 'sendpilot'
    and metadata ? 'providerEventId';

create unique index outreach_sendpilot_reply_message_once_idx
  on public.outreach_events (
    workspace_id,
    owner_id,
    (metadata ->> 'providerMessageId')
  )
  where metadata ->> 'provider' = 'sendpilot'
    and metadata ? 'providerMessageId'
    and kind in (
      'reply', 'positive_reply', 'objection', 'later', 'referral',
      'unsubscribe'
    );

create unique index outreach_sendpilot_enrolment_request_once_idx
  on public.outreach_events (
    workspace_id,
    owner_id,
    (metadata ->> 'requestId')
  )
  where kind = 'linkedin_enrolled'
    and metadata ->> 'provider' = 'sendpilot'
    and metadata ? 'requestId';

create or replace function public.validate_sendpilot_crm_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_table_name = 'sendpilot_campaign_links' then
    if not exists (
      select 1
      from public.outreach_campaigns campaign
      where campaign.id = new.livecoach_campaign_id
        and campaign.workspace_id = new.workspace_id
        and (
          campaign.owner_id = new.owner_id
          or campaign.visibility = 'team'
        )
    ) then
      raise exception 'the LiveCoach campaign is outside this SendPilot workspace';
    end if;
    new.active := new.active and new.sendpilot_campaign_status = 'started';
    return new;
  end if;

  if not exists (
    select 1
    from public.outreach_prospects prospect
    where prospect.id = new.outreach_prospect_id
      and prospect.workspace_id = new.workspace_id
      and prospect.assigned_to_user_id = new.owner_id
  ) then
    raise exception 'the SendPilot lead is not assigned to this salesperson';
  end if;

  if new.campaign_link_id is not null and not exists (
    select 1
    from public.sendpilot_campaign_links mapping
    where mapping.id = new.campaign_link_id
      and mapping.integration_id = new.integration_id
      and mapping.workspace_id = new.workspace_id
      and mapping.owner_id = new.owner_id
      and mapping.sendpilot_campaign_id = new.sendpilot_campaign_id
      and mapping.livecoach_campaign_id is not distinct from new.livecoach_campaign_id
  ) then
    raise exception 'the SendPilot campaign mapping is outside this salesperson scope';
  end if;

  if new.outreach_enrolment_id is not null and not exists (
    select 1
    from public.outreach_enrolments enrolment
    where enrolment.id = new.outreach_enrolment_id
      and enrolment.workspace_id = new.workspace_id
      and enrolment.prospect_id = new.outreach_prospect_id
      and (
        new.livecoach_campaign_id is null
        or enrolment.campaign_id = new.livecoach_campaign_id
      )
  ) then
    raise exception 'the SendPilot lead enrolment is outside this prospect scope';
  end if;

  if new.livecoach_campaign_id is not null and not exists (
    select 1
    from public.outreach_campaigns campaign
    where campaign.id = new.livecoach_campaign_id
      and campaign.workspace_id = new.workspace_id
  ) then
    raise exception 'the SendPilot lead campaign is outside this workspace';
  end if;

  return new;
end;
$$;

create trigger sendpilot_campaign_links_validate_scope
  before insert or update of integration_id, workspace_id, owner_id,
    livecoach_campaign_id, sendpilot_campaign_status, active
  on public.sendpilot_campaign_links
  for each row execute function public.validate_sendpilot_crm_scope();

create trigger sendpilot_lead_links_validate_scope
  before insert or update of integration_id, campaign_link_id, workspace_id,
    owner_id, outreach_prospect_id, outreach_enrolment_id, livecoach_campaign_id
  on public.sendpilot_lead_links
  for each row execute function public.validate_sendpilot_crm_scope();

revoke execute on function public.validate_sendpilot_crm_scope()
  from public, anon, authenticated;

alter table public.sendpilot_campaign_links enable row level security;
alter table public.sendpilot_lead_links enable row level security;
revoke all on public.sendpilot_campaign_links, public.sendpilot_lead_links
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.sendpilot_campaign_links, public.sendpilot_lead_links
  to service_role;

alter table public.outreach_events
  drop constraint if exists outreach_events_kind_check;
alter table public.outreach_events
  add constraint outreach_events_kind_check check (kind in (
    'queued', 'researched', 'drafted', 'approved', 'sent', 'reply',
    'positive_reply', 'objection', 'later', 'referral', 'unsubscribe',
    'meeting_booked', 'booking_link_shared', 'crm_created',
    'learning_promoted', 'safety_override', 'handover_review', 'manual_call',
    'manual_call_interpreted', 'voice_script_approved', 'voice_generated',
    'voice_played',
    'linkedin_enrolled', 'linkedin_connection_sent',
    'linkedin_connection_accepted', 'linkedin_message_sent',
    'sendpilot_status', 'failed'
  ));

comment on table public.sendpilot_campaign_links is
  'Owner-scoped mapping from a LiveCoach campaign to one existing SendPilot campaign.';
comment on table public.sendpilot_lead_links is
  'Canonical link between one assigned CRM prospect and its SendPilot campaign execution state.';
