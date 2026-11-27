# Detailed call requests and actions

The call owner needs a usable action register, not only a short meeting abstract.
The version 2 email recap preserves each distinct safe business request and
commitment, grouped by the recipient or responsible person. It distinguishes
requested work from agreed commitments and retains only evidenced deadlines.

## Default email layout for every user

- Meeting date, the named attendees evidenced by the call, and a short purpose
  or context sentence come first. Generic speaker labels are not people.
- Top five requests then highlights the most important distinct requests from
  the whole call, across all participants, before any per-person breakdown.
  Short calls show only the requests that exist. Each bullet retains its named
  owner, requested/agreed status, deadline and existing traffic-light label.
- Action bullets are grouped by person. The receiving account's own actions
  appear first as Your priorities. Unconfirmed owners remain last.
- Traffic lights are presentation only. Red means explicitly urgent, due today
  or overdue, amber means due within seven days, and green means a later stated
  deadline. Labels accompany colour. Unclear timing stays uncoloured.
- Dates use Europe/London. Relative wording is anchored to the meeting date,
  not a retry date. No task deadline, priority or assignment is written back.
- There is no reconstruction/process preamble or repeated no-deadline text.
  Requests remain distinct from agreements. Email opt-in and recipients are
  unchanged, and this format does not replay delivered emails.

The existing privacy/coverage review selects the top five by evidenced business
impact, blockers, dependencies, explicit emphasis and time-critical deadlines,
not by speaking order or the recipient's seniority. Only approved action
indices are accepted and their ranks stay on those canonical actions. No raw
transcript, extra action list, extra AI request or task assignment is created.
Cached reviewed recaps without ranks fall back to evidenced deadlines and the
existing action order, without reprocessing the call or replaying sent emails.
Unknown timing is not treated as low priority or completed.

## Grounding and privacy

- Extraction receives only safe numbered passages from the exact owner's saved
  call transcript. It never receives prep, coaching or other-client CRM memory.
- An item can cite up to ten exact passages across the request, recipient reply
  and deadline. Server-side resolution owns the quotes and speaker provenance.
- Unknown recipients and unsupported dates stay unconfirmed. The review checks
  that a requester has not been confused with the person asked to do the work.
- A separate review scans all safe passages for missing requests as well as
  privacy and accuracy. Failed coverage holds the email for review, not delivery
  of a misleadingly abbreviated list. Private asides stay excluded.
- Bounds of 100 actions, 16 points and 24 decisions are safety limits, not list
  targets. Exceeding them or hitting model output limits fails closed. No slice
  silently cuts a valid register down to ten or twelve entries.

## Persistence and delivery

Only version 2 proposals that passed validation and review can be delivered by
the updated worker. Proposals are checkpointed against both generation version
and transcript hash, so an unchanged interrupted extraction is not repeated.
Already-sent legacy receipts remain sent and are not replayed by the upgrade.
The exact-account opt-in, active-member recheck, canonical source recheck and
durable uncertain-send barrier are unchanged. Recaps go only to the user's own
connected mailbox. This feature does not assign tasks to other people or email
meeting participants.

The internal summary now preserves individual requested changes and has no
twelve-action postprocessing cap. Long-call condensation is instructed to retain
all asks, attribution and timing. Failed or truncated condensation falls back to
the full source part rather than silently discarding its tail. The existing
summary time budget and durable retry path remain in place.

The saved-call screen and live debrief use the same read-only action register.
The existing summary pass ranks its call-wide overview using action indices,
which are checked and attached to the corresponding normalized actions. Invalid
rank references fall back safely without discarding the action register.
They show the top requests first, then every canonical action, grouped by owner,
before any prepared action pack. Unconfirmed owners remain explicit. This view makes no requests, creates
no tasks and does not treat a recorded request as completed or agreed.

## Validation

`validate:call-recap-emails` covers a 35-item register, multiple source turns,
cross-turn deadlines, requested versus agreed status, unconfirmed attribution,
privacy filtering, incomplete coverage, cached proposals, legacy sent receipts,
account isolation, removal during generation, concurrency, uncertain sends,
Postgres RLS and the actual preference UI. `validate:call-summary-resilience`
checks the existing durable summary path. No database migration is needed.
The actual action-register component is also tested with 49 items, unconfirmed
owners, call changes, malformed legacy values and escaped text.
Overview tests cover late-call priorities, cross-person selection, only approved
references, invalid/duplicate indices, fewer than five requests, duplicate text,
preserved personal detail order and unchanged two-user delivery isolation.

Generative completeness still requires transcript coverage review. The tests do
not claim that a synthetic fixture proves every future model output is perfect.
