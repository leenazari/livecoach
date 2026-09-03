-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create table if not exists contact_company_overrides (
  email text primary key,
  company_id uuid not null references companies(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists contact_company_overrides_company_id_idx
  on contact_company_overrides (company_id);

alter table contact_company_overrides enable row level security;

comment on table contact_company_overrides is
  'Maps a known individual email address to a company. Used by calendar-attendee-sync to link calls for contacts who use free/personal inboxes (gmail, googlemail, etc.) that the domain heuristic would otherwise skip. Service-role access only.';
