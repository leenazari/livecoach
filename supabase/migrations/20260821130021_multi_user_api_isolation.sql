-- Complete the request-scoped database foundation before another LiveCoach
-- member is invited. This migration keeps every existing row and replaces
-- single-user natural-key constraints with account or workspace scoped ones.

-- Private singleton stores can now hold one record per account. Shared app
-- configuration remains one record per workspace.
create unique index if not exists ai_cache_owner_key_uidx
  on public.ai_cache (owner_id, key);

create unique index if not exists app_config_private_owner_key_uidx
  on public.app_config (owner_id, key)
  where visibility = 'private';
create unique index if not exists app_config_team_workspace_key_uidx
  on public.app_config (workspace_id, key)
  where visibility = 'team';

create unique index if not exists contact_company_overrides_owner_email_uidx
  on public.contact_company_overrides (owner_id, email);

create unique index if not exists google_oauth_owner_uidx
  on public.google_oauth (owner_id);
create unique index if not exists workspace_profile_owner_uidx
  on public.workspace_profile (owner_id);

-- Calendar, task, call, generated-document and external-reference identities
-- are unique inside their real account boundary, never across all users.
create unique index if not exists tasks_owner_fingerprint_uidx
  on public.tasks (owner_id, fingerprint)
  where fingerprint is not null;

create unique index if not exists upcoming_calls_owner_external_id_uidx
  on public.upcoming_calls (owner_id, external_id)
  where external_id is not null;

create unique index if not exists interview_sessions_owner_session_id_uidx
  on public.interview_sessions (owner_id, session_id);

create unique index if not exists interview_summaries_owner_cache_key_uidx
  on public.interview_summaries (owner_id, cache_key);

create unique index if not exists document_jobs_owner_idempotency_uidx
  on public.document_jobs (owner_id, idempotency_key);

create unique index if not exists external_refs_workspace_identity_uidx
  on public.external_refs (workspace_id, system, entity_type, external_id);

-- These configuration values describe the shared Interviewa sales motion.
-- Connection credentials, cursors, digest state and secrets remain private.
update public.app_config
set visibility = 'team', updated_at = now()
where key in (
  'revenue_target_gbp',
  'interviewa_outreach_offer_truth',
  'outreach_default_booking_url',
  'outreach_daily_limit'
)
and visibility <> 'team';

-- AI cache entries, email-to-company overrides and event-processing receipts
-- contain no connector secrets. They can use the same owner/team RLS model as
-- the rest of the CRM while credentials and app_config stay server-only.
do $$
declare
  target_table text;
  scoped_internal_tables text[] := array[
    'ai_cache',
    'contact_company_overrides',
    'opportunity_signal_receipts'
  ];
begin
  foreach target_table in array scoped_internal_tables loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('revoke all on public.%I from anon, authenticated', target_table);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      target_table
    );

    execute format(
      'drop policy if exists "Members read permitted internal records" on public.%I',
      target_table
    );
    execute format(
      'create policy "Members read permitted internal records" on public.%1$I for select to authenticated using (
        owner_id = (select auth.uid())
        or (
          visibility = ''team''
          and exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = %1$I.workspace_id
              and wm.user_id = (select auth.uid())
              and wm.status = ''active''
          )
        )
      )',
      target_table
    );

    execute format(
      'drop policy if exists "Members create internal records" on public.%I',
      target_table
    );
    execute format(
      'create policy "Members create internal records" on public.%1$I for insert to authenticated with check (
        owner_id = (select auth.uid())
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = %1$I.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.status = ''active''
        )
      )',
      target_table
    );

    execute format(
      'drop policy if exists "Members update permitted internal records" on public.%I',
      target_table
    );
    execute format(
      'create policy "Members update permitted internal records" on public.%1$I for update to authenticated using (
        owner_id = (select auth.uid())
        or (
          visibility = ''team''
          and exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = %1$I.workspace_id
              and wm.user_id = (select auth.uid())
              and wm.status = ''active''
          )
        )
      ) with check (
        workspace_id in (
          select wm.workspace_id from public.workspace_members wm
          where wm.user_id = (select auth.uid()) and wm.status = ''active''
        )
        and (visibility = ''team'' or owner_id = (select auth.uid()))
      )',
      target_table
    );

    execute format(
      'drop policy if exists "Owners delete permitted internal records" on public.%I',
      target_table
    );
    execute format(
      'create policy "Owners delete permitted internal records" on public.%1$I for delete to authenticated using (
        owner_id = (select auth.uid())
        or exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = %1$I.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.status = ''active''
            and wm.role in (''owner'', ''manager'')
        )
      )',
      target_table
    );
  end loop;
end
$$;
