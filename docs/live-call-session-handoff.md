# Live coaching session handoff

A scheduled notetaker can have a legacy private room and an occurrence-specific
room after a deployment. Both point at one capture. Starting the transcript
listener before calendar hydration could activate the legacy room, then switch
the browser to the occurrence room. The one-active-session constraint correctly
rejected that second activation, leaving recording healthy but coaching silent.

The call page now mounts its scheduled transcript listener only after verifying
the calendar record and its scheduled time. This does not wait for email,
research, focus or AI preparation. Ordinary unscheduled calls are unchanged.

Status recovery reuses an already-active subscription only when workspace,
owner, capture and calendar event all match. It repeats that check if another
tab wins an activation race. A different meeting remains blocked and explicitly
ended subscriptions are not reactivated. No provider bot is sent, stopped or
moved by recovery, and no raw transcript is copied.

Genuine access or different-call conflicts stop the connecting indicator, show
an actionable error, and block streaming and pending bot starts. Returning to
the tab checks again so a resolved conflict can resume the existing notetaker.
Unexpected lookup failures expose a safe support reference, not database text.

Validation covers the actual call-page hydration gate, including slow and failed
loads with a meeting URL already present, the real status route with the
one-active-owner uniqueness rule, concurrent activation, event mismatch,
cross-user/workspace access, ended calls, failed reads, transcript backfill and
the real React listener's coaching callback.

Run `validate:auto-live-recovery`, `validate:call-without-focus`,
`validate:auto-precall-bot`, `validate:call-launch`, `validate:transcriber`,
`validate:shared-meeting-coaching`, and `validate:shared-call-coaching`.
