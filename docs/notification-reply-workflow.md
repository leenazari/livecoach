# Notification reply workflow

## Decision

Notifications suggest actions from the existing inbound-email classification. Opening the feed or reply panel is read-only. Only an explicit Draft reply or Revise draft button generates text. No scheduled reply drafts, audio, sends or bookings.

## Canonical records and isolation

- The notification's exact provider/message key resolves one owned task. Missing or ambiguous matches fail closed.
- Reuse `email_assistant_drafts`, not a parallel notification draft store. Existing drafts are preserved.
- Workspace, user and active membership come from the verified session. Sender, thread and recipient are never inferred from a name or accepted from the browser.
- Existing client-assignment checks, private CRM context, mailbox permissions, suppression checks, source freshness and atomic send claims remain in effect.
- The new nullable `meeting_options` field inherits the table's existing service-only grants and RLS. No new grants or policies.

## Calendar options

On a draft request, extract meeting constraints from the fresh source email, exact thread and explicit user instructions. A deterministic calendar check inserts up to two suitable free times, normally on different days, with 15-minute buffers and at least an hour's notice. Use the user's working hours and timezone. Default to a 30-minute weekday meeting when unspecified.

Read all calendars available through both providers connected to this user. Incomplete permissions, pagination, malformed events, ambiguous date constraints or unavailable providers produce no claimed free times. Keep event names and attendees out of the draft and stored options. Suggestions are not reservations.

Recheck the proposed slots and connected-account identity before explicit send or mailbox handoff. A changed or busy slot stops approval for a refreshed draft. User edits remain visible for review. Only a confirmed send completes the task and dismisses its exact notification.

Outreach and SendPilot notifications still link to their canonical reply workflow. LinkedIn replies are not converted into mailbox emails.

## Release and rollback

Apply `20261026110602_notification_reply_meeting_options.sql` before deploying the reader. It adds one nullable JSON field, preserves records and does not backfill or trigger AI.

Run `validate:notification-replies`, the existing task-email, email-next-move, email-assistant, notification, inbound-reply, calendar and multi-user checks, TypeScript and the Vercel build. The new regression executes real route/service/React code against simulated database, model and mailbox providers. It never sends production email.

Smoke-test an authenticated reply panel with GET only. Do not generate a live draft merely to verify deployment. Roll back the UI/calendar changes if isolation, source matching or delivery fails. Retain the on-request cron policy during rollback. The additive nullable column can remain without affecting the prior application.
