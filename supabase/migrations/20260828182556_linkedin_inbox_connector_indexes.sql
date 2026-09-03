-- Cover every connector foreign key used by delete and scope checks. These
-- indexes are separate from the product query indexes because PostgreSQL needs
-- the foreign-key columns at the start of an index to use it efficiently.

create index linkedin_contact_links_contact_idx
  on public.linkedin_contact_links (contact_id);

create index linkedin_inbox_messages_connector_scope_idx
  on public.linkedin_inbox_messages (connector_id, owner_id, workspace_id)
  where connector_id is not null;

create index linkedin_inbox_messages_contact_idx
  on public.linkedin_inbox_messages (contact_id)
  where contact_id is not null;

create index linkedin_inbox_messages_context_idx
  on public.linkedin_inbox_messages (context_id)
  where context_id is not null;

create index linkedin_inbox_messages_workspace_owner_received_idx
  on public.linkedin_inbox_messages (workspace_id, owner_id, received_at desc);
