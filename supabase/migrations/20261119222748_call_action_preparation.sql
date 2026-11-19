-- Historic calls remain opt-in. Only future summaries enter the automatic queue.
alter table public.interview_summaries
  add column post_call_preparation_state text check (post_call_preparation_state in ('pending','preparing','ready','error')),
  add column post_call_preparation_attempts integer not null default 0,
  add column post_call_preparation_lease timestamptz,
  add column post_call_preparation_error text;
create index interview_summaries_action_recovery on public.interview_summaries(workspace_id,owner_id,created_at)
  where post_call_preparation_state in ('pending','preparing','error');

-- One native draft per prepared action. Nullable keys preserve existing drafts.
alter table public.follow_ups add column source_action_key text;
create unique index follow_ups_prepared_action_unique on public.follow_ups(workspace_id,owner_id,session_id,source_action_key);
