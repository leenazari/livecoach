-- Availability suggestions belong to the existing private draft, not a second
-- calendar or email store. Existing service-only grants and RLS are retained.
alter table public.email_assistant_drafts
  add column if not exists meeting_options jsonb;
comment on column public.email_assistant_drafts.meeting_options is
  'On-request availability proposals only. Never a reservation. Rechecked before sending.';
