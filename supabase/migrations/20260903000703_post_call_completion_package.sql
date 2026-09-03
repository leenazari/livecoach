alter table public.interview_summaries
  add column if not exists post_call_package jsonb;

alter table public.interview_summaries
  add constraint interview_summaries_post_call_package_object_check
  check (
    post_call_package is null
    or jsonb_typeof(post_call_package) = 'object'
  ) not valid;

alter table public.interview_summaries
  validate constraint interview_summaries_post_call_package_object_check;

comment on column public.interview_summaries.post_call_package is
  'One exact-call completion package containing relationship updates, commercial outcome, commitments, next focus and the unsent follow-up draft.';
