# Automatic call capture and private recap emails

Calendar sync and provider change notifications reserve supported meeting links
for the next seven days. They reconcile moved or cancelled events against the
same canonical `upcoming_calls` record. No browser tab or minute-by-minute poll
is required to launch a reserved bot.

## Account timing

`app_config.notetaker_schedule_preference` is private to one workspace and owner.
The JSON value `{"leadMinutes":2}` requests arrival two minutes before the booked
time. Unconfigured accounts retain the existing one-minute timing. Only one or
two minutes are accepted. Browser-supplied timestamps and other accounts' team
settings cannot override this policy.

For an exact verified shared calendar occurrence, the earliest arrival requested
by its active attendees is used. One shared capture is retimed in place while
each attendee retains their own call room, preparation and coaching. Independent
meetings and other workspace members do not affect the timing. A reservation
the provider has already locked is retained, never duplicated to change timing.

The existing 15-minute no-participant/no-recording protection remains. Teams and
Zoom use a 15-minute lobby timeout. Recall's Google Meet lobby cap is ten minutes.
Once the call is underway, everyone-left and five-minute silence protection
remain unchanged. Hosts still need to admit a bot when their meeting requires it.

## Recap emails

Enable `call_recap_email_preference` separately for each active user with an
`enabledSince` timestamp. Do not reuse another user's value or backdate consent.
The recap worker discovers only newly completed calls owned by that user. It
sends only to that user's connected mailbox, never automatically to prospects.
Private coaching and CRM context are excluded. Unverified or unsafe content is
held for review. Existing per-session receipts prevent duplicate delivery.

## Validation

- `scripts/validate-automatic-precall-bots.mjs`
- `scripts/validate-background-notetaker-dispatch.mjs`
- `scripts/validate-calendar-cancellation.mjs`
- `scripts/validate-capture-finalisation.mjs`
- `scripts/validate-call-recap-emails.mjs`

After changing account timing, reconcile that exact account's calendar and
verify both `meet_bots.scheduled_join_at` and the provider reservation. Do not
manually change just the CRM timestamp or disturb bots already in a live call.
