-- Foreign keys prove that related rows exist, but they do not prove that the
-- rows belong to the same workspace or describe the same contact. Enforce the
-- compound relationship before any outreach record can be queued or sent.
create or replace function public.validate_outreach_relationship_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  workspace_value uuid := nullif(to_jsonb(new)->>'workspace_id', '')::uuid;
  campaign_value uuid := nullif(to_jsonb(new)->>'campaign_id', '')::uuid;
  prospect_value uuid := nullif(to_jsonb(new)->>'prospect_id', '')::uuid;
  enrolment_value uuid := nullif(to_jsonb(new)->>'enrolment_id', '')::uuid;
begin
  if not exists (
    select 1
    from public.outreach_campaigns c
    where c.id = campaign_value
      and c.workspace_id = workspace_value
  ) then
    raise exception 'The outreach campaign belongs to a different workspace';
  end if;

  if not exists (
    select 1
    from public.outreach_prospects p
    where p.id = prospect_value
      and p.workspace_id = workspace_value
  ) then
    raise exception 'The outreach contact belongs to a different workspace';
  end if;

  if tg_table_name = 'outreach_messages' and not exists (
    select 1
    from public.outreach_enrolments e
    where e.id = enrolment_value
      and e.workspace_id = workspace_value
      and e.campaign_id = campaign_value
      and e.prospect_id = prospect_value
  ) then
    raise exception 'The outreach email does not match its campaign enrolment';
  end if;

  return new;
end
$$;

drop trigger if exists outreach_enrolments_validate_relationship_scope
  on public.outreach_enrolments;
create trigger outreach_enrolments_validate_relationship_scope
  before insert or update of workspace_id, campaign_id, prospect_id
  on public.outreach_enrolments
  for each row execute function public.validate_outreach_relationship_scope();

drop trigger if exists outreach_messages_validate_relationship_scope
  on public.outreach_messages;
create trigger outreach_messages_validate_relationship_scope
  before insert or update of
    workspace_id, enrolment_id, campaign_id, prospect_id
  on public.outreach_messages
  for each row execute function public.validate_outreach_relationship_scope();

revoke execute on function public.validate_outreach_relationship_scope()
  from public, anon, authenticated;
