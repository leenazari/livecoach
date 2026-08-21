-- Support workspace removal and the server-side workspace scoped token cleanup
-- without scanning the short-lived transcript token table.

create index if not exists meet_stream_tokens_workspace_owner_session_idx
  on public.meet_stream_tokens (workspace_id, owner_id, session_id);
