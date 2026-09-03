-- Supabase applies broad authenticated default privileges to newly created
-- public tables. Remove every mutation privilege that the MCP receipt writer
-- does not need. RLS already has no delete policy, so this is defence in depth.

revoke delete, truncate, references, trigger
  on table public.mcp_action_receipts
  from authenticated;
