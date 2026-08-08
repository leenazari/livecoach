-- Separate genuine sales from investment, internal projects and strategic ideas.
-- Existing records are retained; only their forecast classification changes.

alter table public.opportunities
  add column if not exists opportunity_type text not null default 'revenue';

alter table public.opportunities drop constraint if exists opportunities_opportunity_type_check;
alter table public.opportunities add constraint opportunities_opportunity_type_check
  check (opportunity_type in ('revenue','investment','internal','strategic'));

-- The seed round is capital raised, not Interviewa customer revenue.
update public.opportunities
set opportunity_type = 'investment', forecast_category = 'omitted', updated_at = now()
where id = 'be38eba8-0778-4a01-8dea-bf2ca80ca7d9';

-- Product delivery work belongs in tasks and product context, not the sales forecast.
update public.opportunities
set opportunity_type = 'internal', forecast_category = 'omitted', updated_at = now()
where id in (
  'b6d6e860-2858-47ae-9d75-2eb10bab3f69',
  '7c1fcd41-3711-4ad4-8c50-6505ee9e37ee',
  '86363318-92a5-4d12-b06e-04dd65f3bdd1',
  '5ae60120-f0df-4cbd-9460-cea171560d62',
  'c54b542a-5c6f-40d5-9789-971f0fdf75af'
);

-- Useful future routes or commercial inputs, but not current buyer deals.
update public.opportunities
set opportunity_type = 'strategic', forecast_category = 'omitted', updated_at = now()
where id in (
  '7bd1d2b4-6b1f-452d-9e3a-99e459bf42e5',
  'd5398dcd-a480-4beb-b102-6c6e0521984a',
  '570d39fd-ef4a-4fc7-a45f-a8a2d1e88af5',
  'c30d9d01-92b6-4352-843d-16c3a3f101cf',
  '64c9edf4-3d3a-41ba-8173-2de9f9aa72bc'
);

create index if not exists opportunities_revenue_forecast_idx
  on public.opportunities (status, opportunity_type, forecast_category, expected_close_at);
