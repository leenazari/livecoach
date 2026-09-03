-- These links are used for calendar deletion and cleanup paths. Cover both
-- foreign keys so an upcoming-call update never needs to scan call captures.
create index if not exists meet_bots_source_upcoming_idx
  on public.meet_bots (source_upcoming_id)
  where source_upcoming_id is not null;

create index if not exists meet_capture_subscribers_upcoming_idx
  on public.meet_capture_subscribers (upcoming_id)
  where upcoming_id is not null;
