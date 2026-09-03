-- A connector receipt can move from started to one final outcome exactly once.
-- Its immutable request identity was already protected in the base migration.

create or replace function public.protect_mcp_action_receipt_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.actor_user_id is distinct from old.actor_user_id
    or new.oauth_client_id is distinct from old.oauth_client_id
    or new.tool_name is distinct from old.tool_name
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.request_summary is distinct from old.request_summary
    or new.created_at is distinct from old.created_at then
    raise exception 'MCP receipt identity cannot be changed';
  end if;

  if old.completed_at is not null or old.outcome <> 'started' then
    raise exception 'A completed MCP receipt cannot be changed';
  end if;

  if new.outcome = 'started' or new.completed_at is null then
    raise exception 'An MCP receipt update must record one final outcome';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_mcp_action_receipt_identity()
  from public, anon, authenticated;
