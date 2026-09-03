-- Supabase project default privileges can grant service_role more than the
-- explicit statement in the creation migration. Receipts are intentionally
-- retained for idempotency, so remove destructive privileges explicitly.

revoke all on table public.opportunity_signal_receipts from service_role;
grant select, insert, update on table public.opportunity_signal_receipts to service_role;
