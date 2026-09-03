-- Restored from the production Supabase migration history.
-- This preserves the SQL already applied under this immutable version.

create sequence if not exists call_ref_seq;
alter table interview_summaries add column if not exists ref text;
with ordered as (
  select id, row_number() over (order by created_at) as rn
  from interview_summaries where ref is null
)
update interview_summaries s set ref = 'LC-' || lpad(o.rn::text, 4, '0')
from ordered o where s.id = o.id;
select setval('call_ref_seq', greatest((select count(*) from interview_summaries), 1), true);
alter table interview_summaries alter column ref set default 'LC-' || lpad(nextval('call_ref_seq')::text, 4, '0');
