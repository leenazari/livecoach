-- Manual rollback only. Do not run this against production unless Lee asks.
-- It removes the SendPilot match function and the new event kinds.
-- It does not delete Adam prospects, drafts, or the campaign row.

delete from public.outreach_events
where kind in ('sheet_imported', 'sheet_writeback');

alter table public.outreach_events drop constraint if exists outreach_events_kind_check;
alter table public.outreach_events add constraint outreach_events_kind_check check (kind in (
  'queued','researched','drafted','approved','sent','reply','positive_reply','objection','later','referral',
  'unsubscribe','meeting_booked','booking_link_shared','crm_created','learning_promoted','safety_override',
  'handover_review','manual_call','manual_call_interpreted','voice_script_approved','voice_generated',
  'voice_played','linkedin_enrolled','linkedin_connection_sent','linkedin_connection_accepted',
  'linkedin_message_sent','sendpilot_status','failed','notification_action'
));

drop function if exists public.adam_sendpilot_touches(uuid, text[], text[]);
drop function if exists public.adam_linkedin_key(text);

-- Pause the campaign without deleting its leads:
-- update public.outreach_campaigns
-- set status = 'paused', updated_at = now()
-- where slug = 'adam_daily_leads';
