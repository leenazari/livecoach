# Lead clash rollback

Phase 1 is off until a workspace owner turns it on. Company creation, contact edits, calendar sync, email pull, campaigns, SendPilot and same-owner merges keep their current behaviour while the switch is off, and also if the new database function is missing.

## 1. Kill switch

Two controls. Either one being off stops every new check, warning, sync change and notification.

| Control | Effect | How fast |
| --- | --- | --- |
| `lead_clash_settings.enabled` | The live switch. Missing row or `false` means current behaviour. The clash function itself returns no rows while this is false, including a direct API call. | Immediate. No redeploy. |
| `LEAD_CLASH_FORCE_OFF=1` or `LEAD_CLASH_ENABLED=off` | Forces the app off even if the database row says on. An environment value cannot turn the feature on. | Takes effect on the next Vercel deployment that picks up the variable. |

Turn it off in the duplicate report (**Turn lead clash checks off**) or with SQL:

```sql
insert into public.lead_clash_settings (workspace_id, enabled, updated_at)
values ('<workspace uuid>', false, now())
on conflict (workspace_id) do update
  set enabled = false, updated_at = now();
```

After that, creates and sync go back to inserting a private company exactly as they do today. Already-created clash rows and notifications stay as history. They do not change CRM records.

Turn it on only after the migration has been applied and the preview checks below have passed:

```sql
insert into public.lead_clash_settings (workspace_id, enabled, updated_at, updated_by)
values ('<workspace uuid>', true, now(), '<owner user uuid>')
on conflict (workspace_id) do update
  set enabled = true, updated_at = now(), updated_by = excluded.updated_by;
```

## 2. Down migration

`supabase/rollbacks/20261101163000_lead_clash_phase1_down.sql` is not in `supabase/migrations`, so a normal migration run will not apply it.

It removes only the phase 1 objects:

- functions `lead_clash_check` and its helpers
- tables `lead_clash_settings`, `lead_clash_exclusions`, `lead_clashes`, `crm_company_merge_audit`
- the `lead_clash` notification kind and `lead_clashes` source table value

It deletes notification rows whose kind is `lead_clash` or whose source table is `lead_clashes`, then restores the previous notification check. It does not update or delete companies, contacts, calls, opportunities, campaigns or SendPilot rows.

Run it only after the kill switch is off and a fresh backup exists. If a cross-owner merge has already been applied, this down migration does not undo that merge. Use the audit snapshot described below.

## 3. Vercel rollback

1. Open the project in Vercel and select the production deployment that was live before this release.
2. Use **Instant Rollback** / **Promote** on that previous deployment. Do not promote this branch until Lee has reviewed the preview.
3. Confirm production is serving the previous deployment id.
4. If the database migration was also applied, turn `lead_clash_settings.enabled` off first. The previous app build ignores the new tables, so leaving them in place is safe. Run the down migration only if the new objects themselves must be removed.

## 4. Pre-deploy checklist

1. Take a Supabase backup or confirm point-in-time recovery is available for project `prnojuixshdxrgurbrlh`. Do this before any production migration.
2. Apply `supabase/migrations/20261101163000_lead_clash_phase1.sql` to a Supabase preview branch or a local database first. Do not run it against production from this pull request.
3. Leave `lead_clash_settings.enabled` false. Create a company, add a contact, and run a calendar sync in the preview. They should match current production behaviour.
4. Turn the switch on in the preview only. Repeat the create, contact and sync checks with a seeded duplicate owned by another member.
5. Open the Vercel preview deployment for this pull request and repeat those checks there, still against the preview database.
6. Confirm a sales user still cannot read another rep's company row directly.

## 5. Post-deploy smoke tests and rollback triggers

Watch these for the first day after the switch is turned on:

- Company create and contact save error rate, especially HTTP 500s on `/api/crm/companies` and `/api/crm/contacts`. A 409 `lead_clash` is the warning card, not a failure.
- Calendar sync and email pull success. A held duplicate is `created: false` with the event or message still accepted. A 500 from those routes is a failure.
- `crm_notifications` rows with `kind = 'lead_clash'`. A sudden large volume means the matcher is too broad. Turn the switch off.
- Duplicate report load time and any 500 from `/api/crm/duplicates`.

Roll back immediately when any of these happen:

- Company create, contact save, calendar sync or email pull fails for people who are not looking at a clash warning.
- A rep can see another rep's notes, email body, or deal value in the warning card or notification.
- Notification volume keeps growing for the same company after one sync.
- The duplicate report or merge screen shows records outside the caller's workspace.

Rollback order: set `enabled = false`, then promote the previous Vercel deployment if the failure is in the app. Use the down migration only when the new database objects must be removed.

## 6. Cross-owner merges are irreversible

The existing `merge_crm_companies` function moves linked rows and deletes the duplicate. That cannot be replayed backwards automatically.

A cross-owner merge additionally requires `acknowledgeIrreversible: true` and the kept company name. Before the merge function runs, both full company rows are written to `crm_company_merge_audit` (`before_keep`, `before_merge`, previous owners, requested owner). `applied_at` is set only after the merge function returns. If the snapshot cannot be saved, the merge does not start.

To rebuild by hand, read the audit row for that pair and recreate the deleted company from `before_merge`, then move linked rows back using `moved` counts on `crm_company_redirects` where present. Do this in a transaction in a restored backup or with a second person checking the ids. Do not run a second merge to try to undo the first.

Same-owner merges keep the previous path, including the existing redirect snapshot, and do not require the new audit table.
