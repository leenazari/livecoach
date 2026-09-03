-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

-- LiveCoach CRM - per-client AI assistant threads + a company-scoped context
-- store (notes, links, documents that augment a client beyond its calls).
-- Additive, RLS enabled, no policies (service-role only).

create table if not exists public.assistant_messages (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users(id) on delete set null,
  company_id  uuid references public.companies(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists assistant_messages_company_idx
  on public.assistant_messages(company_id, created_at);
alter table public.assistant_messages enable row level security;

create table if not exists public.client_context (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users(id) on delete set null,
  company_id  uuid references public.companies(id) on delete cascade,
  kind        text not null default 'note' check (kind in ('note','link','doc')),
  title       text,
  url         text,
  content     text,                                  -- extracted text / note body
  created_at  timestamptz not null default now()
);
create index if not exists client_context_company_idx
  on public.client_context(company_id, created_at);
alter table public.client_context enable row level security;
