-- One explicit commercial next action per revenue opportunity. This keeps the
-- command centre, Brain and post-call workflow aligned without duplicating the
-- full task list inside every prompt.
alter table public.opportunities
  add column if not exists next_action text,
  add column if not exists next_action_due_at timestamptz,
  add column if not exists next_action_owner text not null default 'us';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'opportunities_next_action_owner_check'
      and conrelid = 'public.opportunities'::regclass
  ) then
    alter table public.opportunities
      add constraint opportunities_next_action_owner_check
      check (next_action_owner in ('us', 'buyer', 'joint'));
  end if;
end
$$;

create index if not exists opportunities_open_next_action_due_idx
  on public.opportunities (next_action_due_at)
  where status = 'open' and opportunity_type = 'revenue';

comment on column public.opportunities.next_action is
  'The single primary commercial action required to progress this opportunity.';
comment on column public.opportunities.next_action_due_at is
  'When the primary commercial next action should happen.';
comment on column public.opportunities.next_action_owner is
  'Who owns the primary next action: us, buyer, or joint.';
