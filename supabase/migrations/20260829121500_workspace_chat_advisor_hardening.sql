-- Make the service-only email receipt boundary explicit to the database linter
-- and cover chat foreign keys used during member removal and workspace cleanup.

create policy "No browser access to chat email deliveries"
  on public.crm_chat_email_deliveries for all to authenticated
  using (false)
  with check (false);

create index if not exists crm_chat_conversations_creator_idx
  on public.crm_chat_conversations (created_by_user_id);
create index if not exists crm_chat_conversations_last_message_idx
  on public.crm_chat_conversations (last_message_id)
  where last_message_id is not null;
create index if not exists crm_chat_members_workspace_idx
  on public.crm_chat_conversation_members (workspace_id);
create index if not exists crm_chat_members_added_by_idx
  on public.crm_chat_conversation_members (added_by_user_id);
create index if not exists crm_chat_messages_sender_idx
  on public.crm_chat_messages (sender_user_id);
create index if not exists crm_chat_attachments_conversation_idx
  on public.crm_chat_attachments (conversation_id);
create index if not exists crm_chat_email_deliveries_user_idx
  on public.crm_chat_email_deliveries (user_id);
