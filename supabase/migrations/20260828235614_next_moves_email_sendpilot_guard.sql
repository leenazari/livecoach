-- LiveCoach remains the final CRM source of truth across email and SendPilot.
-- These service-only records add a human-approved email next-move queue and a
-- workspace-wide identity guard for every SendPilot account connected by the
-- sales team. No row in this migration is exposed through the public Data API.

alter table public.sendpilot_lead_links
  add column email text;

update public.sendpilot_lead_links link
set email = lower(btrim(prospect.email))
from public.outreach_prospects prospect
where prospect.id = link.outreach_prospect_id
  and prospect.workspace_id = link.workspace_id
  and btrim(coalesce(prospect.email, '')) <> ''
  and link.email is null;

alter table public.sendpilot_lead_links
  add constraint sendpilot_lead_links_email_normalised_check
  check (email is null or email = lower(btrim(email)));

drop index if exists public.sendpilot_lead_links_active_linkedin_once_idx;

create unique index sendpilot_lead_links_workspace_linkedin_once_idx
  on public.sendpilot_lead_links (workspace_id, linkedin_url);

create unique index sendpilot_lead_links_workspace_email_once_idx
  on public.sendpilot_lead_links (workspace_id, lower(email))
  where email is not null and btrim(email) <> '';

create table public.sendpilot_lead_reviews (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  sendpilot_lead_id text not null,
  sendpilot_campaign_id text not null,
  sendpilot_campaign_name text,
  linkedin_url text not null,
  email text,
  first_name text,
  last_name text,
  company_name text,
  job_title text,
  external_status text,
  custom_lead_status text,
  review_reason text not null check (review_reason in (
    'unmatched',
    'missing_linkedin',
    'ambiguous_linkedin',
    'ambiguous_email',
    'identity_conflict',
    'assigned_to_another_user',
    'unassigned_prospect',
    'workspace_duplicate'
  )),
  status text not null default 'pending' check (status in (
    'pending', 'resolved', 'dismissed'
  )),
  matched_prospect_id uuid references public.outreach_prospects(id) on delete set null,
  resolution_note text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sendpilot_lead_reviews_integration_scope_fkey
    foreign key (integration_id, owner_id, workspace_id)
    references public.sendpilot_integrations(id, owner_id, workspace_id)
    on delete cascade,
  constraint sendpilot_lead_reviews_email_normalised_check
    check (email is null or email = lower(btrim(email))),
  unique (integration_id, sendpilot_lead_id)
);

create index sendpilot_lead_reviews_owner_status_idx
  on public.sendpilot_lead_reviews (workspace_id, owner_id, status, last_seen_at desc);
create index sendpilot_lead_reviews_linkedin_idx
  on public.sendpilot_lead_reviews (workspace_id, linkedin_url);
create index sendpilot_lead_reviews_email_idx
  on public.sendpilot_lead_reviews (workspace_id, lower(email))
  where email is not null;
create index sendpilot_lead_reviews_matched_prospect_idx
  on public.sendpilot_lead_reviews (matched_prospect_id)
  where matched_prospect_id is not null;

create table public.email_assistant_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility = 'private'),
  company_id uuid references public.companies(id) on delete set null,
  outreach_prospect_id uuid references public.outreach_prospects(id) on delete set null,
  source_task_id uuid references public.tasks(id) on delete set null,
  mail_provider text not null check (mail_provider in ('google', 'microsoft')),
  source_message_id text not null,
  source_thread_id text,
  source_received_at timestamptz not null,
  recipient_email text not null,
  recipient_name text,
  draft_subject text not null,
  draft_body text not null,
  intent text not null,
  next_step text not null,
  evidence_summary text not null,
  confidence integer not null check (confidence between 0 and 100),
  urgency text not null check (urgency in ('normal', 'high', 'urgent')),
  generation_mode text not null check (generation_mode in ('immediate', 'overnight')),
  due_at timestamptz,
  status text not null default 'draft' check (status in (
    'draft', 'approving', 'handed_off', 'dismissed', 'stale', 'blocked'
  )),
  provider_draft_id text,
  provider_draft_url text,
  approved_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_assistant_drafts_recipient_normalised_check
    check (recipient_email = lower(btrim(recipient_email))),
  unique (workspace_id, owner_id, mail_provider, source_message_id)
);

create index email_assistant_drafts_owner_queue_idx
  on public.email_assistant_drafts
  (workspace_id, owner_id, status, urgency, due_at, created_at desc);
create index email_assistant_drafts_company_idx
  on public.email_assistant_drafts (company_id, created_at desc)
  where company_id is not null;
create index email_assistant_drafts_prospect_idx
  on public.email_assistant_drafts (outreach_prospect_id, created_at desc)
  where outreach_prospect_id is not null;
create index email_assistant_drafts_task_idx
  on public.email_assistant_drafts (source_task_id)
  where source_task_id is not null;
create index email_assistant_drafts_thread_idx
  on public.email_assistant_drafts
  (workspace_id, owner_id, mail_provider, source_thread_id)
  where source_thread_id is not null;

create or replace function public.validate_next_move_record_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_table_name = 'sendpilot_lead_reviews' then
    if new.matched_prospect_id is not null and not exists (
      select 1
      from public.outreach_prospects prospect
      where prospect.id = new.matched_prospect_id
        and prospect.workspace_id = new.workspace_id
        and prospect.assigned_to_user_id = new.owner_id
    ) then
      raise exception 'the reviewed SendPilot lead is outside this salesperson scope';
    end if;
    return new;
  end if;

  if new.company_id is not null and not exists (
    select 1
    from public.companies company
    where company.id = new.company_id
      and company.workspace_id = new.workspace_id
      and company.owner_id = new.owner_id
  ) then
    raise exception 'the email draft company is outside this mailbox scope';
  end if;

  if new.outreach_prospect_id is not null and not exists (
    select 1
    from public.outreach_prospects prospect
    where prospect.id = new.outreach_prospect_id
      and prospect.workspace_id = new.workspace_id
      and prospect.assigned_to_user_id = new.owner_id
  ) then
    raise exception 'the email draft prospect is outside this mailbox scope';
  end if;

  if new.source_task_id is not null and not exists (
    select 1
    from public.tasks task
    where task.id = new.source_task_id
      and task.workspace_id = new.workspace_id
      and task.owner_id = new.owner_id
  ) then
    raise exception 'the email draft task is outside this mailbox scope';
  end if;

  return new;
end;
$$;

create trigger sendpilot_lead_reviews_validate_scope
  before insert or update of integration_id, workspace_id, owner_id,
    matched_prospect_id
  on public.sendpilot_lead_reviews
  for each row execute function public.validate_next_move_record_scope();

create trigger email_assistant_drafts_validate_scope
  before insert or update of workspace_id, owner_id, company_id,
    outreach_prospect_id, source_task_id
  on public.email_assistant_drafts
  for each row execute function public.validate_next_move_record_scope();

revoke execute on function public.validate_next_move_record_scope()
  from public, anon, authenticated;

alter table public.sendpilot_lead_reviews enable row level security;
alter table public.email_assistant_drafts enable row level security;

revoke all on public.sendpilot_lead_reviews, public.email_assistant_drafts
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.sendpilot_lead_reviews, public.email_assistant_drafts
  to service_role;

comment on table public.sendpilot_lead_reviews is
  'Owner-private review queue for SendPilot leads that cannot be matched by exact LinkedIn URL or exact email.';
comment on table public.email_assistant_drafts is
  'Owner-private, approval-only next-move email drafts generated from exact inbound mailbox messages.';
