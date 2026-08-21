-- Once delivery starts, the recipient snapshot is the exact address and
-- company used for that attempt. A concurrent correction to the canonical
-- prospect must not rewrite the sent audit record after Gmail accepts it.
create or replace function public.freeze_inflight_outreach_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status = 'sending' then
    new.recipient_email := old.recipient_email;
    new.company_key := old.company_key;
    new.delivery_day := old.delivery_day;
  end if;
  return new;
end
$$;

drop trigger if exists outreach_messages_freeze_inflight_identity
  on public.outreach_messages;
create trigger outreach_messages_freeze_inflight_identity
  before update of status, recipient_email, company_key, delivery_day
  on public.outreach_messages
  for each row execute function public.freeze_inflight_outreach_identity();

revoke execute on function public.freeze_inflight_outreach_identity()
  from public, anon, authenticated;
