# Sales lead workspace

The New leads page uses compact company rows. Opening a name or its workspace
button opens one large workspace without changing the list's filters, page or
scroll position. Previous and Next move through the currently loaded page only.

## Sources and boundaries

- The existing assigned-lead projection supplies the company, canonical contact,
  source-sheet status, holding page and explicitly shared import notes.
- `/api/crm/new-leads/[id]/workspace` rechecks active membership and the exact lead
  assignment before reading anything else. It returns at most 12 of the current
  user's notes, 8 of their open tasks, and the permitted canonical opportunity.
- Workspace ownership does not grant another person's private task or mailbox
  history here. The existing email-history component still requires an explicit
  click before reading messages or querying the connected mailbox.
- History is not copied into another table. Loading the workspace does not call
  an AI model, draft an email, alter a stage or contact the lead.

## Explicit writes

Notes and call logs use the existing company activity endpoint with
`analyse: false`. This new mode validates the account and company again, stores
one `client_context` source note, and returns its confirmed values. It does not
run the existing activity-intelligence or automatic-application path.

The form retains its request UUID after a lost response. The note's primary key
resolves an identical retry to that same source. A conflicting payload, company
or account cannot overwrite or retrieve the original note. Unsaved text remains
visible on errors and while refreshing the history.

Tasks use the existing TaskComposer and task API, with the company fixed and a
stable request ID. Sales opportunity creation remains a separate explicit
confirmation. No schema migration or live-data backfill is needed.

## Navigation safety

Closing, switching leads or changing form mode asks before discarding unsaved
work. Navigation is blocked during a save. Native Escape and unload guards read
the latest reported form state synchronously, including the interval before
React commits a parent render after a save. Dictation is stopped on save and
unmount, and late recognition events cannot modify another lead's form.

The native modal traps keyboard focus and returns it to the opening control.
Mobile contact details collapse so the next action and logging controls remain
prominent. Full company and pipeline links open separately, preserving the list.

## Validation

Run `npm run validate:lead-workspace` alongside the assigned-lead, team-cover,
team-sharing, sales-history/navigation and unified-task-composer regressions.
The new validator covers two-user and workspace isolation, removed members,
read failures versus empty history, bounded results, confirmed saves, replay
conflicts, dirty navigation, stale responses and correct company/task linkage.

Browser checks should exercise native Escape immediately after a task save,
focus restoration, phone-width overflow, note dictation cleanup and the same
flow in light and dark themes. These checks use fixtures, not real email sends
or disposable writes in production customer records.
