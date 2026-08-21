-- Signal identities and processing receipts belong to the account that owns
-- the opportunity. This prevents identical source IDs or malformed links from
-- crossing account boundaries.

create unique index if not exists opportunity_signal_receipts_owner_source_uidx
  on public.opportunity_signal_receipts (
    owner_id,
    company_id,
    source_record_type,
    source_record_id
  );
