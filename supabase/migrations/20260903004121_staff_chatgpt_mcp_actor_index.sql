-- Cover the auth.users foreign key independently. The main receipt index is
-- workspace-first for the product query, while user deletion checks start
-- with actor_user_id.

create index if not exists mcp_action_receipts_actor_fk_idx
  on public.mcp_action_receipts (actor_user_id);
