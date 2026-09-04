-- Let a salesperson turn an owned email task into one private, approval-only
-- draft and send that exact version from their own connected mailbox. The
-- sending claim fails closed so a retry can never deliver a duplicate email.

alter table public.email_assistant_drafts
  add column if not exists provider_message_id text,
  add column if not exists sent_at timestamptz;

alter table public.email_assistant_drafts
  drop constraint if exists email_assistant_drafts_status_check,
  add constraint email_assistant_drafts_status_check check (status in (
    'draft', 'approving', 'handed_off', 'sending', 'sent',
    'dismissed', 'stale', 'blocked'
  )),
  drop constraint if exists email_assistant_drafts_sent_receipt_check,
  add constraint email_assistant_drafts_sent_receipt_check check (
    status <> 'sent' or sent_at is not null
  );

create index if not exists email_assistant_drafts_task_delivery_idx
  on public.email_assistant_drafts
  (workspace_id, owner_id, source_task_id, status, updated_at desc)
  where source_task_id is not null;

-- A task can belong to a salesperson who has an active safe-share grant for a
-- non-confidential client. Allow that exact link while continuing to reject a
-- bare workspace match or another salesperson's private company.
create or replace function public.validate_next_move_record_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_table_name = 'sendpilot_lead_reviews' then
    if new.matched_prospect_id is not null and not exists (
      select 1
      from public.outreach_prospects prospect
      where prospect.id = new.matched_prospect_id
        and prospect.workspace_id = new.workspace_id
        and prospect.assigned_to_user_id = new.owner_id
    ) then
      raise exception 'the reviewed SendPilot lead is outside this salesperson scope';
    end if;
    return new;
  end if;

  if new.company_id is not null and not exists (
    select 1
    from public.companies company
    where company.id = new.company_id
      and company.workspace_id = new.workspace_id
      and (
        company.owner_id = new.owner_id
        or (
          company.is_confidential = false
          and exists (
            select 1
            from public.team_client_shares share
            where share.workspace_id = new.workspace_id
              and share.company_id = company.id
              and share.assigned_to_user_id = new.owner_id
              and share.status = 'active'
          )
        )
      )
  ) then
    raise exception 'the email draft company is outside this mailbox scope';
  end if;

  if new.outreach_prospect_id is not null and not exists (
    select 1
    from public.outreach_prospects prospect
    where prospect.id = new.outreach_prospect_id
      and prospect.workspace_id = new.workspace_id
      and prospect.assigned_to_user_id = new.owner_id
  ) then
    raise exception 'the email draft prospect is outside this mailbox scope';
  end if;

  if new.source_task_id is not null and not exists (
    select 1
    from public.tasks task
    where task.id = new.source_task_id
      and task.workspace_id = new.workspace_id
      and task.owner_id = new.owner_id
  ) then
    raise exception 'the email draft task is outside this mailbox scope';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_next_move_record_scope()
  from public, anon, authenticated;

comment on table public.email_assistant_drafts is
  'Owner-private approval drafts generated from exact inbound messages or owned email tasks. Provider delivery is always a separate human action.';
comment on column public.email_assistant_drafts.provider_message_id is
  'Provider message receipt when Gmail or Microsoft returns one after an accepted task-email send.';
comment on column public.email_assistant_drafts.sent_at is
  'Time the signed-in salesperson own mailbox accepted the exact approved task email.';
