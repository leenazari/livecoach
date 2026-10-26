# Notification action log

## Product behaviour

- **Done** records a human completion, completes the exact linked open task, and clears that notification. It does not claim to have sent an email, attended a meeting or moved a deal stage.
- **Log action** accepts typed or live dictated notes, an action channel and an optional next step/date. The completion checkbox can be unticked to leave the original action open.
- **Your action log** reads the user's existing `client_context` notes, 20 at a time. Notes remain available after notifications disappear, including for prospects not yet converted to clients.
- A next step becomes a private canonical task. Exactly one matching active deal gets its next action updated as an explicit human override. Multiple deals or separate workstreams are not guessed.
- Done clears a pipeline next action only when it exactly matches the completed task. Other next actions, intent, outlook and lifecycle remain unchanged.
- The next call reads the same canonical notes. Saved focus shows a new-activity prompt. Rebuilding focus explicitly incorporates the note and acknowledges its source ID. Manual intent/focus are never silently rewritten.
- Dismiss and Mark read retain their existing meaning. Neither represents completed work.
- Drafting and sending remain explicit, separate actions. This workflow makes no AI or provider calls.

## Architecture decision

Use a service-only, security-invoker PostgreSQL function for the atomic write, not a chain of independent HTTP writes or a second activity database. The route validates a strict payload and derives actor/workspace from verified middleware. The function rechecks and locks active membership, notification ownership and target records. Only service_role has EXECUTE.

Notifications resolve their existing exact task/provider/event identifiers. Reply timestamp matching cannot complete a newer reply from the same person. Ordinary shared sales clients require assignment or owner-enabled cover. Confidential, investor, internal, personal and protected partner clients stay blocked for non-owners. Notes default to private. Outreach events contain a note reference, never its private text.

The canonical note's unique `(owner_id, source_ref)` provides replay protection. A request ID is retained on failed UI saves. An identical retry returns the stored receipt. Changed payloads under the same ID are rejected. A dismissed notification cannot be completed again with a fresh ID.

No new table is introduced. The migration adds one RPC and extends the existing outreach event kind constraint. Existing rows and evidence remain intact. A note, exact task completion, follow-up task, pipeline update, outreach reference and notification resolution commit together or roll back together.

## Intentional limits

Free-form notes are evidence, not instructions to invent deal stages or arbitrary follow-up dates. Users explicitly enter a next step/date when needed. Ambiguous deal selection is reported, while the note and task still save. There is no automatic email generation, voice generation, calendar booking or full-history reanalysis.

## Validation

`npm run validate:notification-actions` exercises the actual migration in local PostgreSQL via PGlite, plus the HTTP route and React composer. It covers exact-source identity, duplicate retries, two-user/workspace access, removed users, protected clients, safe sales assignment/cover, unchanged manual focus, transactional rollback, live speech visibility, retained errors and newest-activity sorting.

Existing notification/reply, task, call-focus, calendar and privacy checks should also pass before release. Production checks must not mark real customer work completed or create fake notes.
