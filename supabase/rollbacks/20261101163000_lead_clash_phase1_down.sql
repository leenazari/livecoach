-- Down migration for lead-clash phase 1.
-- This file is NOT in supabase/migrations, so it is not applied automatically.
-- It removes only the objects added by 20261101163000_lead_clash_phase1.sql.
-- It does not alter companies, contacts, calls, campaigns or SendPilot rows.
-- Lead-clash notification receipts are removed first so the restored
-- notification check constraint can be applied. Other notification rows stay.

delete from public.crm_notifications
where kind = 'lead_clash'
   or source_table = 'lead_clashes';

alter table public.crm_notifications
  drop constraint if exists crm_notifications_kind_check,
  add constraint crm_notifications_kind_check check (
    kind in (
      'outreach_reply', 'important_email', 'lead_assigned', 'chat_message',
      'work_assigned'
    )
  ),
  drop constraint if exists crm_notifications_source_table_check,
  add constraint crm_notifications_source_table_check check (
    source_table in (
      'outreach_prospects', 'opportunities', 'companies', 'crm_chat_messages',
      'tasks'
    )
  );

drop function if exists public.lead_clash_check(
  uuid, text, text, text[], text[], uuid, uuid, uuid, text[], text[], text[]
);
drop function if exists public.lead_clash_contact_label(text);
drop function if exists public.lead_clash_linkedin_slug(text);
drop function if exists public.lead_clash_possible_name_key(text);
drop function if exists public.lead_clash_name_key(text);
drop function if exists public.lead_clash_domain_excluded(text);
drop function if exists public.lead_clash_domain(text);

drop table if exists public.crm_company_merge_audit;
drop table if exists public.lead_clashes;
drop table if exists public.lead_clash_exclusions;
drop table if exists public.lead_clash_settings;
