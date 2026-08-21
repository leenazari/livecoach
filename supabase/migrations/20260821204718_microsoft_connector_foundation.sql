-- Store one private Microsoft Graph connection for each LiveCoach account. The
-- connector is optional. CRM membership never depends on having a mailbox or
-- calendar provider, while mail and calendar features use this record only
-- after that user explicitly connects Microsoft.

create table if not exists public.microsoft_oauth (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private'
    check (visibility = 'private'),
  account_id text,
  tenant_id text,
  email text,
  refresh_token text,
  access_token text,
  expiry timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists microsoft_oauth_owner_uidx
  on public.microsoft_oauth (owner_id);

create unique index if not exists microsoft_oauth_workspace_email_uidx
  on public.microsoft_oauth (workspace_id, lower(email))
  where email is not null;

create index if not exists microsoft_oauth_workspace_idx
  on public.microsoft_oauth (workspace_id);

alter table public.microsoft_oauth enable row level security;

-- OAuth secrets are server-only. The service-role client is used only after
-- request or cron scope has selected the exact account owner.
revoke all on public.microsoft_oauth from public, anon, authenticated;
grant select, insert, update, delete on public.microsoft_oauth to service_role;
