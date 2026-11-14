-- Not applied. Cost rates, per-call cost rows, deck slides and a private slide bucket.
-- Apply on a Supabase branch before using internal costs or live slides.

alter table public.interviewer_config
  add column if not exists voice_agent_usd_per_minute numeric(12, 6) not null default 0.075,
  add column if not exists voice_agent_byo_usd_per_minute numeric(12, 6),
  add column if not exists use_byo_llm boolean not null default false,
  add column if not exists listen_usd_per_minute numeric(12, 6) not null default 0.0077,
  add column if not exists tts_usd_per_1k_chars numeric(12, 6) not null default 0.015,
  add column if not exists openai_input_usd_per_million numeric(12, 4) not null default 0.15,
  add column if not exists openai_output_usd_per_million numeric(12, 4) not null default 0.60,
  add column if not exists storage_usd_per_gb numeric(12, 6) not null default 0.021,
  add column if not exists vercel_usd_per_call numeric(12, 6) not null default 0.0002,
  add column if not exists usd_to_gbp numeric(12, 6) not null default 0.79;

comment on column public.interviewer_config.voice_agent_usd_per_minute is
  'Deepgram Voice Agent Standard pay-as-you-go, USD per connected minute.';
comment on column public.interviewer_config.usd_to_gbp is
  'How many pounds one US dollar is worth. Internal only.';

alter table public.interviewer_sessions
  add column if not exists recording_bytes integer;

create table if not exists public.interviewer_session_costs (
  session_id uuid primary key references public.interviewer_sessions(id) on delete cascade,
  workspace_id uuid not null,
  campaign_id uuid not null,
  connected_seconds integer not null default 0,
  voice_agent_usd numeric(12, 6) not null default 0,
  listen_usd numeric(12, 6) not null default 0,
  llm_usd numeric(12, 6) not null default 0,
  storage_usd numeric(12, 6) not null default 0,
  vercel_usd numeric(12, 6) not null default 0,
  total_usd numeric(12, 6) not null default 0,
  total_gbp numeric(12, 6) not null default 0,
  revenue_gbp numeric(12, 4),
  margin_gbp numeric(12, 4),
  margin_percent numeric(8, 2),
  created_at timestamptz not null default now()
);

create table if not exists public.interviewer_cost_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid,
  kind text not null check (kind in ('tts_preview', 'website_import', 'deck_vision')),
  usd_amount numeric(12, 6) not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists interviewer_cost_events_campaign_idx
  on public.interviewer_cost_events (campaign_id, created_at desc);

create table if not exists public.interviewer_decks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  title text not null,
  outline text not null default '',
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (campaign_id, workspace_id)
    references public.interviewer_campaigns(id, workspace_id) on delete cascade
);

create table if not exists public.interviewer_slides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  deck_id uuid not null references public.interviewer_decks(id) on delete cascade,
  slide_number integer not null check (slide_number > 0),
  image_path text not null,
  image_mime text not null default 'image/svg+xml',
  title text not null default '',
  one_line text not null default '',
  talking_points text not null default '',
  verbatim text,
  stats text not null default '',
  unique (deck_id, slide_number)
);

create table if not exists public.interviewer_slide_shows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  session_id uuid not null references public.interviewer_sessions(id) on delete cascade,
  slide_number integer not null,
  reason text,
  shown_at timestamptz not null default now()
);

create index if not exists interviewer_slide_shows_session_idx
  on public.interviewer_slide_shows (session_id, shown_at);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interviewer-slides',
  'interviewer-slides',
  false,
  20971520,
  array['image/svg+xml', 'image/png', 'image/jpeg']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.interviewer_session_costs enable row level security;
alter table public.interviewer_cost_events enable row level security;
alter table public.interviewer_decks enable row level security;
alter table public.interviewer_slides enable row level security;
alter table public.interviewer_slide_shows enable row level security;

revoke all on public.interviewer_session_costs from anon;
revoke all on public.interviewer_cost_events from anon;
revoke all on public.interviewer_decks from anon;
revoke all on public.interviewer_slides from anon;
revoke all on public.interviewer_slide_shows from anon;

grant select on public.interviewer_session_costs to authenticated, service_role;
grant select on public.interviewer_cost_events to authenticated, service_role;
grant select, insert on public.interviewer_decks to authenticated, service_role;
grant select, insert on public.interviewer_slides to authenticated, service_role;
grant select on public.interviewer_slide_shows to authenticated, service_role;

drop policy if exists interviewer_session_costs_owner on public.interviewer_session_costs;
create policy interviewer_session_costs_owner on public.interviewer_session_costs
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_cost_events_owner on public.interviewer_cost_events;
create policy interviewer_cost_events_owner on public.interviewer_cost_events
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_decks_owner on public.interviewer_decks;
create policy interviewer_decks_owner on public.interviewer_decks
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_slides_owner on public.interviewer_slides;
create policy interviewer_slides_owner on public.interviewer_slides
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));

drop policy if exists interviewer_slide_shows_owner on public.interviewer_slide_shows;
create policy interviewer_slide_shows_owner on public.interviewer_slide_shows
  for select to authenticated
  using (public.interviewer_caller_can_access(workspace_id));
