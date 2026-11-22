# New leads and Pipeline

New leads remains a projection of canonical companies, contacts and active team assignments. Pipeline stores buying opportunities under those same company IDs. Existing record owners, assignments, notes, transcripts and call workstreams are preserved.

## Behaviour

- The navigation keeps New leads next to Pipeline, with a switch on both screens. Companies replaces Clients in the directory navigation.
- Confirm sales opportunity creates/reuses one open revenue opportunity for the active assignee. Owner confirmations do not assign the opportunity to the owner. Amount remains unknown and probability zero until reviewed.
- A five-minute server job consumes qualified **sent** Adam leads and tracking. Page views and demo starts stay engagement signals. Positive replies, bookings and explicit confirmations hand off to pipeline. Other replies and confirmed demo completion create follow-up tasks without a deal. Stable source/event keys prevent duplicate opportunities, tasks and notifications, including retries after an interrupted response.
- Exact website domain links companies. Exact primary/additional email addresses identify contacts. Ambiguous domains, other-company email matches, protected records and ownership conflicts stop for owner review. No name-only contact merging. Existing historical assignments, including Lee's, are preserved. Future unassigned leads go to configured Cam/Sharon accounts.
- Contact owners can manage up to ten emails per person. The first-class email remains the primary address; additional addresses are in `attributes.emails`. Database triggers prevent new domain and email collisions across account boundaries without revealing private records. Existing duplicate records are not bulk merged or rewritten.
- Brain obtains counts in Postgres and at most 12 safe company rows. Non-owners see only their assigned leads. It never loads lead transcripts or email bodies for this report. Missing campaign attribution stays unknown. Date filters are explicitly based on company creation time. Historical tracking coverage is limited to the feed available to the sync; a start is never relabelled as completion.

## Source connection and operation

The Adam tables do not carry workspace IDs. `sales_lead_connections` binds that feed to one verified workspace/owner and two active sales users, ordered Cam then Sharon. This is server-only configuration, never supplied by a browser or inferred from a raw lead. Enable only after verifying this source belongs to that workspace. Existing source metadata is preserved; campaign and criteria attribution are recorded independently per new source receipt.

The job imports at most 25 new sources and processes at most 100 new events per pass. It makes no model calls, launches no campaigns and sends no email. Intake exceptions are saved in `sales_lead_reviews` with a one-day recheck. Tracking uses exact slug/token; ambiguous company mappings are skipped. Reply/booking links require a verified source-lead ID, never a guessed name or sheet row. Exact-email opt-outs and stored company restrictions block handoff. Existing pipeline-exclusion decisions remain authoritative. The job is safe to repeat after a failure; successfully saved event receipts stay authoritative.

New tables are RLS-enabled and server-only. RPCs are security invoker with execute granted only to service_role and explicit active membership/assignment checks. Two narrow identity guard triggers use privileged lookup, revoke direct execute and expose only a generic collision result.

## Validation and rollout

`pnpm validate:sales-lead-handoff`, assigned-lead isolation, private calls/navigation, pipeline-entry, sheet-import rollback, multi-user checks and TypeScript validate the implementation. Local SQL uses PGlite with synthetic accounts; UI runs actual components with simulated database/network. These checks do not establish authenticated end-to-end production behaviour or prove that an upstream mailer emits a currently absent event type.

Apply the additive migration before deploying readers. Bind the source after confirming the active owner and sales users. Do not bulk reassign or merge historical data. Deploy through a checked branch/PR, then verify production commit, aliases, signed-out denial and a scoped read-only report. Rollback disables the new connection/cron and reverts the application PR. Leave receipt tables and identity history intact; removing triggers requires an explicit migration if existing workflows prove incompatible.

Production schema applied as `20261122204558_sales_lead_handoff`. Initial scoped report returned 277 assigned leads, with 277 historical campaign attributions unknown. The new feed connection remains off until application deployment. Security advisor warnings match the existing baseline; four additional no-policy notices are intentional server-only receipt/configuration tables with public grants revoked.
