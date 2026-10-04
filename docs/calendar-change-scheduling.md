# Calendar-driven bot scheduling

Calendar notifications enqueue an account-scoped refresh of the canonical `upcoming_calls` rows. That refresh reconciles the existing Recall reservations at meeting start minus five minutes. It does not duplicate calendar events or transcripts and invokes no new AI analysis.

- Google watches each readable, non-noise calendar and the calendar list. The latter picks up newly added/shared calendars. Incomplete provider snapshots never prove cancellation.
- Microsoft watches `/me/events` for created, updated and deleted events. Lifecycle notifications reauthorize/renew subscriptions using one PATCH. Delegated Microsoft access does not support notifications for someone else's shared mailbox. Existing full calendar sync remains the fallback for those calendars.
- Provider subscriptions are maintained only in production. Renewal creates a Google replacement before retiring its old channel. Microsoft renews in place.
- Webhooks verify a random, per-channel secret using its stored SHA-256 hash, provider resource/subscription ID, current connected mailbox, active membership and workspace. Google sequence numbers reject duplicate/out-of-order notifications. No calendar contents or caller-supplied owner IDs are trusted.
- A durable, coalesced `calendar_sync_jobs` record is committed before HTTP acknowledgement. One account lease prevents overlapping snapshots. Changes during a read increment the version and are read again after the old version finishes. Failed workers retain pending work with backoff.
- Every 15 minutes a database-only check bootstraps missing watches, renews expiring subscriptions and retries unfinished jobs. Healthy accounts without changes do not call calendar APIs. Existing occasional full sync is retained because provider delivery is not guaranteed.
- OAuth connection starts sync/setup in the background. Disconnect and suspended membership fail closed. No user has to keep a CRM tab open.
- Moving a meeting outside the scheduling horizon cancels its obsolete future reservation. A cancellation in the five-minute pre-meeting window can withdraw an idle bot, but must not terminate an early conversation with captured speech or another participant's shared reservation.

## Operational checks

`calendar_notification_channels` contains server-only subscription metadata and hashed verification tokens. `last_notified_at`, `status`, `expires_at`, `needs_renewal` and `last_error` diagnose provider registration/delivery. Never log the provider tokens or raw notification bodies.

`calendar_sync_jobs.pending`, `attempts`, `last_error` and the lease timestamps diagnose processing. Confirm the exact `owner_id` and `workspace_id`, then compare the corresponding `upcoming_calls` time/link with `meet_bots.scheduled_join_at` and `scheduled_meeting_url`.

Tests include `validate-calendar-change-notifications.mjs` (disposable PostgreSQL, two-user authorization and concurrent queue generations), `validate-calendar-watch-providers.mjs` (provider contracts and renewal), `validate-calendar-cancellation.mjs` (shared capture/timing), and existing calendar/transcriber regressions.

Notifications can be delayed or missed by providers. Do not promise instantaneous delivery. Changes in LiveCoach itself continue to reconcile the schedule directly.
