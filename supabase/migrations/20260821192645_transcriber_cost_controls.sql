-- Give every workspace member an owner-controlled daily Recall allowance and
-- enforce one active transcriber per person. Existing call and transcript data
-- remains untouched. Only impossible active rows older than the provider hard
-- limit are reconciled so they cannot block a person's next call.

alter table public.workspace_members
  add column if not exists transcriber_daily_minutes_limit integer
    not null default 360;

alter table public.workspace_members
  drop constraint if exists workspace_members_transcriber_daily_minutes_check,
  add constraint workspace_members_transcriber_daily_minutes_check
    check (transcriber_daily_minutes_limit between 30 and 720) not valid;

alter table public.workspace_members
  validate constraint workspace_members_transcriber_daily_minutes_check;

comment on column public.workspace_members.transcriber_daily_minutes_limit is
  'Owner-controlled maximum Recall bot minutes per Europe/London calendar day.';

update public.meet_bots
set status = 'left',
    ended_at = created_at + interval '3 hours'
where status = 'active'
  and ended_at is null
  and created_at < now() - interval '3 hours';

create unique index if not exists meet_bots_one_active_per_owner_uidx
  on public.meet_bots (workspace_id, owner_id)
  where status = 'active';

create index if not exists meet_bots_owner_created_idx
  on public.meet_bots (workspace_id, owner_id, created_at desc);

comment on index public.meet_bots_one_active_per_owner_uidx is
  'Prevents concurrent Recall bots for the same LiveCoach account.';
