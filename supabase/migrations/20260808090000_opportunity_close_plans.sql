-- Persistent mutual close plans for each revenue opportunity.
-- Additive only: existing opportunities keep working with an empty plan.
alter table public.opportunities
  add column if not exists close_plan jsonb not null default '{"targetCloseDate":null,"milestones":[]}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.opportunities
set close_plan = '{"targetCloseDate":null,"milestones":[]}'::jsonb
where close_plan is null;

