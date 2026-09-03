-- The local connector is intentionally light touch. Existing settings are
-- reduced before the database constraint is tightened so no import can read
-- more than the previous fourteen days.

update public.linkedin_inbox_connectors
set lookback_days = 14,
    updated_at = now()
where lookback_days > 14;

alter table public.linkedin_inbox_connectors
  drop constraint if exists linkedin_inbox_connectors_lookback_days_check;

alter table public.linkedin_inbox_connectors
  add constraint linkedin_inbox_connectors_lookback_days_check
  check (lookback_days between 1 and 14);

comment on column public.linkedin_inbox_connectors.lookback_days is
  'User-selected lookback bounded to the previous fourteen days.';
