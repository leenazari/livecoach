# Detailed call requests and actions

The call owner needs a usable action register, not only a short meeting abstract.
The version 2 email recap preserves each distinct safe business request and
commitment, grouped by the recipient or responsible person. It distinguishes
requested work from agreed commitments and retains only evidenced deadlines.

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
They render every canonical action, grouped by owner, before any prepared action
pack. Unconfirmed owners remain explicit. This view makes no requests, creates
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

Generative completeness still requires transcript coverage review. The tests do
not claim that a synthetic fixture proves every future model output is perfect.
