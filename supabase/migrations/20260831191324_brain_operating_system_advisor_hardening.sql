-- Remove SELECT overlap from the explicit fail-closed policies. Data API
-- grants already allow SELECT only, while these command-specific policies make
-- the browser write boundary clear without adding a second SELECT policy.

drop policy if exists "No browser writes to Brain routine runs"
  on public.brain_routine_runs;
drop policy if exists "No browser writes to Brain chat messages"
  on public.crm_chat_brain_messages;

create policy "No browser inserts to Brain routine runs"
  on public.brain_routine_runs for insert to authenticated
  with check (false);
create policy "No browser updates to Brain routine runs"
  on public.brain_routine_runs for update to authenticated
  using (false)
  with check (false);
create policy "No browser deletes from Brain routine runs"
  on public.brain_routine_runs for delete to authenticated
  using (false);

create policy "No browser inserts to Brain chat messages"
  on public.crm_chat_brain_messages for insert to authenticated
  with check (false);
create policy "No browser updates to Brain chat messages"
  on public.crm_chat_brain_messages for update to authenticated
  using (false)
  with check (false);
create policy "No browser deletes from Brain chat messages"
  on public.crm_chat_brain_messages for delete to authenticated
  using (false);

-- Cover every new foreign key in its declared column order. The main access
-- indexes begin with workspace_id, which is ideal for scoped reads but does not
-- cover auth.users owner foreign keys or the composite relationship keys.
create index if not exists brain_learnings_owner_fk_idx
  on public.brain_learnings (owner_id);
create index if not exists brain_routine_runs_owner_fk_idx
  on public.brain_routine_runs (owner_id);
create index if not exists brain_routine_runs_routine_scope_fk_idx
  on public.brain_routine_runs (routine_id, workspace_id, owner_id);
create index if not exists brain_routines_owner_fk_idx
  on public.brain_routines (owner_id);
create index if not exists brain_routines_play_scope_fk_idx
  on public.brain_routines (play_id, workspace_id)
  where play_id is not null;
create index if not exists brain_trust_rules_owner_fk_idx
  on public.brain_trust_rules (owner_id);
create index if not exists crm_chat_brain_messages_conversation_scope_fk_idx
  on public.crm_chat_brain_messages (conversation_id, workspace_id);
create index if not exists crm_chat_brain_messages_source_scope_fk_idx
  on public.crm_chat_brain_messages (source_message_id, conversation_id, workspace_id);
