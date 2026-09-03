-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

-- A call is definitively over once its summary is written (whether ended
-- properly or closed by the 15-min orphan sweep). Close any still-open bot for
-- that session, so meet_bots never leaks "active" rows even if /api/meet/stop
-- is never called (e.g. the tab is closed). search_path pinned to satisfy the
-- function linter; objects are schema-qualified.
create or replace function public.close_meet_bots_on_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_id is not null then
    update public.meet_bots
       set status = 'left', ended_at = now()
     where session_id = new.session_id
       and ended_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_close_meet_bots_on_summary on public.interview_summaries;
create trigger trg_close_meet_bots_on_summary
after insert on public.interview_summaries
for each row execute function public.close_meet_bots_on_summary();
