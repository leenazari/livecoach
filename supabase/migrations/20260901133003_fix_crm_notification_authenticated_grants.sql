-- Notification state is written through a request-scoped authenticated client.
-- Keep browser access read-only apart from the three user-owned state fields.
alter table public.crm_notifications enable row level security;

revoke all on table public.crm_notifications from anon;
revoke insert, delete, truncate, references, trigger
  on table public.crm_notifications from authenticated;

grant select on table public.crm_notifications to authenticated;
grant update (read_at, dismissed_at, snoozed_until)
  on table public.crm_notifications to authenticated;
