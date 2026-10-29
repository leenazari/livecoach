-- A calendar reservation may need to become an immediate, on-demand bot when
-- a salesperson explicitly starts the call early or after its booked time.
-- Keep the provider capture active while one request owns that replacement so
-- two teammates cannot create duplicate bots for the same shared occurrence.

alter table public.meet_bots
  add column if not exists manual_dispatch_claimed_at timestamptz;

comment on column public.meet_bots.manual_dispatch_claimed_at is
  'Short-lived server claim while a scheduled Recall bot is replaced by an immediate manual launch. Null outside that handover.';
