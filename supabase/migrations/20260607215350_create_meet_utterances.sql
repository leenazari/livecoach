-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

-- Persistence + refresh-recovery for Meet (Recall.ai) transcripts.
-- The live path is a direct worker->page websocket; the worker ALSO writes
-- here so a page refresh can backfill the transcript-so-far, and so calls are
-- saved. Read server-side (service role); RLS locked, no policies, consistent
-- with public.interview_summaries.
create table if not exists public.meet_utterances (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,                 -- ties to the LiveCoach room/session
  speaker     text,                           -- participant name from Recall (e.g. "Lee")
  role        text,                           -- optional mapped role: 'host' | 'guest'
  text        text not null,                  -- the utterance
  is_final    boolean not null default true,  -- Recall may send interim + final
  ts          timestamptz not null default now(), -- utterance time (worker may set)
  created_at  timestamptz not null default now()
);

create index if not exists meet_utterances_session_created_idx
  on public.meet_utterances (session_id, created_at);

alter table public.meet_utterances enable row level security;
-- No policies = service-role-only. The worker (service role) inserts; a
-- server-side Vercel route (service role) reads for backfill on refresh.
