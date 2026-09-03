-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists public.company_priority (
  company_id uuid primary key references public.companies(id) on delete cascade,
  position int not null,
  updated_at timestamptz not null default now()
);
