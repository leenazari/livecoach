-- Adam outbound campaign.
-- This file is not applied by the pull request. Lee reviews it and applies it
-- on a preview database before production.

alter table public.outreach_campaigns
  add column if not exists slug text,
  add column if not exists playbook jsonb not null default '{}'::jsonb;

comment on column public.outreach_campaigns.slug is
  'Stable campaign tag. Adam outbound uses adam_daily_leads.';
comment on column public.outreach_campaigns.playbook is
  'Campaign product, lead rules and email prompt. Adam drafting reads this row rather than a hard-coded prompt.';

alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_name_key;

create unique index if not exists outreach_campaigns_workspace_name_uidx
  on public.outreach_campaigns (workspace_id, lower(name));

create unique index if not exists outreach_campaigns_workspace_slug_uidx
  on public.outreach_campaigns (workspace_id, slug)
  where slug is not null and length(btrim(slug)) > 0;

alter table public.outreach_events drop constraint if exists outreach_events_kind_check;
alter table public.outreach_events add constraint outreach_events_kind_check check (kind in (
  'queued','researched','drafted','approved','sent','reply','positive_reply','objection','later','referral',
  'unsubscribe','meeting_booked','booking_link_shared','crm_created','learning_promoted','safety_override',
  'handover_review','manual_call','manual_call_interpreted','voice_script_approved','voice_generated',
  'voice_played','linkedin_enrolled','linkedin_connection_sent','linkedin_connection_accepted',
  'linkedin_message_sent','sendpilot_status','failed','notification_action',
  'sheet_imported','sheet_writeback'
));

create or replace function public.adam_linkedin_key(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(pg_catalog.lower(pg_catalog.btrim(coalesce(value, ''))), '^https?://', ''),
          '^www\.', ''
        ),
        '[?#].*$', ''
      ),
      '/+$', ''
    ),
    ''
  );
$$;

create or replace function public.adam_sendpilot_touches(
  p_workspace uuid,
  p_emails text[] default null,
  p_linkedin text[] default null
)
returns table (
  match_type text,
  match_value text,
  sync_status text,
  owner_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  emails text[];
  links text[];
begin
  if p_workspace is null or auth.uid() is null or not exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = p_workspace
      and member.user_id = auth.uid()
      and member.status = 'active'
  ) then
    raise exception 'adam_sendpilot_touch_forbidden' using errcode = '42501';
  end if;

  emails := coalesce((
    select pg_catalog.array_agg(pg_catalog.lower(pg_catalog.btrim(item)))
    from pg_catalog.unnest(coalesce(p_emails, array[]::text[])) as item
    where pg_catalog.strpos(item, '@') > 1
  ), array[]::text[]);
  links := coalesce((
    select pg_catalog.array_agg(public.adam_linkedin_key(item))
    from pg_catalog.unnest(coalesce(p_linkedin, array[]::text[])) as item
    where public.adam_linkedin_key(item) is not null
  ), array[]::text[]);

  return query
  select
    case
      when public.adam_linkedin_key(link.linkedin_url) = any(links) then 'linkedin'
      else 'email'
    end as match_type,
    case
      when public.adam_linkedin_key(link.linkedin_url) = any(links)
        then public.adam_linkedin_key(link.linkedin_url)
      else pg_catalog.lower(pg_catalog.btrim(link.email))
    end as match_value,
    link.sync_status,
    case
      when profile.display_name is null or pg_catalog.btrim(profile.display_name) = ''::text then 'A teammate'::text
      else pg_catalog.btrim(profile.display_name)
    end as owner_display_name
  from public.sendpilot_lead_links link
  left join public.profiles profile on profile.user_id = link.owner_id
  where link.workspace_id = p_workspace
    and link.sync_status is distinct from 'failed'
    and (
      public.adam_linkedin_key(link.linkedin_url) = any(links)
      or pg_catalog.lower(pg_catalog.btrim(coalesce(link.email, ''::text))) = any(emails)
    )
  limit 5;
end;
$$;

revoke all on function public.adam_linkedin_key(text) from public, anon;
revoke all on function public.adam_sendpilot_touches(uuid, text[], text[]) from public, anon;
grant execute on function public.adam_linkedin_key(text) to authenticated, service_role;
grant execute on function public.adam_sendpilot_touches(uuid, text[], text[]) to authenticated, service_role;

comment on function public.adam_sendpilot_touches(uuid, text[], text[]) is
  'Minimal SendPilot identity match for Adam outbound. Returns a teammate name and status, not message content.';

insert into public.outreach_campaigns (
  workspace_id,
  owner_id,
  visibility,
  name,
  slug,
  goal,
  audience,
  offer_angle,
  status,
  approval_mode,
  daily_limit,
  booking_cta_mode,
  sequence,
  playbook,
  cta_config,
  voice,
  banned_phrases
)
select
  owner_row.workspace_id,
  owner_row.user_id,
  'team',
  'Adam outbound',
  'adam_daily_leads',
  'Book a short Adam trial after a human approves each email',
  'Companies supplied by the Adam daily leads sheet',
  'Adam: AI website greeter and sales avatar. £99 per month including about 350 minutes, then £0.35 per minute.',
  'active',
  true,
  20,
  'never',
  '[{"step":1,"delayDays":0,"channel":"email","actionType":"email","contentType":"plain","purpose":"First Adam email, approved by a human before it sends"}]'::jsonb,
  jsonb_build_object(
    'kind', 'adam_outbound',
    'version', 0,
    'sheet', jsonb_build_object(
      'spreadsheetId', '1J7AzUwaTJNSbUxoDs0BCQLvLOrTZXxPN8oqSHrnD0FU',
      'tab', 'Leads'
    )
  ),
  '{"type":"link","label":"Watch the Adam demo","url":""}'::jsonb,
  '{"tone":"plain, specific and calm","style":"short British English","rules":["Lead with the number already in why Adam fits","Mention the buying signal","Include the demo link","Offer one success number before a trial","Stay under 120 words","Never invent figures"]}'::jsonb,
  '["hope you are well","just reaching out","quick question","circle back","touch base"]'::jsonb
from (
  select distinct on (member.workspace_id) member.workspace_id, member.user_id
  from public.workspace_members member
  where member.role = 'owner'
    and member.status = 'active'
  order by member.workspace_id, member.created_at asc
) owner_row
where not exists (
  select 1
  from public.outreach_campaigns campaign
  where campaign.workspace_id = owner_row.workspace_id
    and campaign.slug = 'adam_daily_leads'
);
