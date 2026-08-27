-- Keep one private LinkedIn connection for each LiveCoach user. LinkedIn
-- credentials are never available through the browser-facing Data API. The
-- application service role may use them only after middleware has selected an
-- exact signed-in workspace member.

create table if not exists public.linkedin_oauth (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private'
    check (visibility = 'private'),
  member_id text,
  email text,
  display_name text,
  picture_url text,
  access_token text,
  refresh_token text,
  expiry timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists linkedin_oauth_owner_uidx
  on public.linkedin_oauth (owner_id);

create unique index if not exists linkedin_oauth_workspace_member_uidx
  on public.linkedin_oauth (workspace_id, member_id)
  where member_id is not null;

create index if not exists linkedin_oauth_workspace_idx
  on public.linkedin_oauth (workspace_id);

alter table public.linkedin_oauth enable row level security;

-- OAuth credentials are server-only. There are deliberately no user-facing
-- policies because even the account owner must not receive raw access tokens.
revoke all on public.linkedin_oauth from public, anon, authenticated;
grant select, insert, update, delete on public.linkedin_oauth to service_role;
