-- Not applied. Do not run this on production until Lee approves it.
-- Drops the voice allow-list so the app can validate against the Deepgram
-- catalogue. Adds the owner's voice shortlist, the campaign website address,
-- a few agent switches, and the stored pre-call brief.

alter table public.interviewer_campaigns
  drop constraint if exists interviewer_campaigns_voice_id_check;

alter table public.interviewer_campaigns
  add column if not exists website_url text,
  add column if not exists website_scraped_at timestamptz,
  add column if not exists quotes_allowed boolean not null default false,
  add column if not exists brochure_send boolean not null default false,
  add column if not exists opener text;

alter table public.interviewer_campaigns
  drop constraint if exists interviewer_campaigns_website_url_check;
alter table public.interviewer_campaigns
  add constraint interviewer_campaigns_website_url_check
  check (website_url is null or length(trim(website_url)) between 8 and 500);

alter table public.interviewer_campaigns
  drop constraint if exists interviewer_campaigns_opener_check;
alter table public.interviewer_campaigns
  add constraint interviewer_campaigns_opener_check
  check (opener is null or length(trim(opener)) between 1 and 400);

create table if not exists public.interviewer_voice_shortlist (
  workspace_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  voice_id text not null check (length(trim(voice_id)) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (workspace_id, owner_id, voice_id)
);

create table if not exists public.interviewer_call_briefs (
  session_id uuid primary key references public.interviewer_sessions(id) on delete cascade,
  workspace_id uuid not null,
  campaign_id uuid not null,
  brief jsonb not null,
  source text not null default 'model' check (source in ('model', 'record')),
  created_at timestamptz not null default now()
);

alter table public.interviewer_voice_shortlist enable row level security;
alter table public.interviewer_call_briefs enable row level security;

revoke all on public.interviewer_voice_shortlist from anon;
revoke all on public.interviewer_call_briefs from anon;

grant select, insert, delete on public.interviewer_voice_shortlist to authenticated, service_role;
grant select on public.interviewer_call_briefs to authenticated, service_role;

drop policy if exists interviewer_voice_shortlist_select on public.interviewer_voice_shortlist;
create policy interviewer_voice_shortlist_select on public.interviewer_voice_shortlist
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id) and owner_id = auth.uid());

drop policy if exists interviewer_voice_shortlist_insert on public.interviewer_voice_shortlist;
create policy interviewer_voice_shortlist_insert on public.interviewer_voice_shortlist
  for insert to authenticated
  with check (public.interviewer_caller_can_access(workspace_id) and owner_id = auth.uid());

drop policy if exists interviewer_voice_shortlist_delete on public.interviewer_voice_shortlist;
create policy interviewer_voice_shortlist_delete on public.interviewer_voice_shortlist
  for delete to authenticated
  using (public.interviewer_caller_can_access(workspace_id) and owner_id = auth.uid());

drop policy if exists interviewer_call_briefs_select on public.interviewer_call_briefs;
create policy interviewer_call_briefs_select on public.interviewer_call_briefs
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));
