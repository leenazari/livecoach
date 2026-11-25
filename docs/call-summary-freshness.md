# Call recap source freshness

Scheduled meeting rooms now include the verified calendar start time. Calendar
and browser starts compute the same ID for the same occurrence, including
equivalent time-zone representations. A moved meeting receives a new room
instead of inheriting the previous no-show's transcript and summary. Existing
legacy captures remain recoverable for their actual occurrence, but the status
fallback rejects an older meeting's ended capture or mismatched reservation.

Each new summary stores a SHA-256 fingerprint of its existing transcript and
the exact session ID. It does not copy raw transcript content. Summary jobs,
retry, status and recovery share the same freshness predicate. Unchanged
sources are reused without an AI pass. Legacy summaries remain valid unless
the captured call ended more than two minutes after their generation, allowing
only small end-call write-order differences.

A changed source replaces the same canonical recap with an owner/workspace
scoped, cache-key guarded update. The old summary and action package remain in
private `post_call_package.summaryRevisions`. They are not passed to generation
or reused as the current action pack. A failed read or save is not reported as
successful just because the old row still exists. Active generation leases are
respected even by explicit retry clicks. New speech detected during generation
returns a retryable conflict rather than publishing stale output.

The compact client memory includes a stable content fingerprint, so correcting
the same recap at the same end time refreshes Brain and prep context. Pipeline
evidence receipts are revision-specific and idempotent. The worker checks the
canonical recap before and after assessment and ignores superseded evidence.
It does not re-assess unchanged recaps or change manual pipeline overrides.

The assessment prompt separates agreed trial implementation from potential
wider adoption, and removes forced minimum concern bullets. This protects
against negative framing of ordinary setup questions without requiring a
positive outcome when the evidence says otherwise. It does not guarantee that
an AI-generated summary will be error-free.

No schema migration, permission expansion, transcript duplication, or new poll
is required. Existing per-account recovery runs perform the freshness check.
Already-sent recap receipts are not reset or replayed by this change.

Run `npm run validate:call-summary-freshness` for executable tests of the job
and save route, source changes, stale no-shows, idempotency, failures, private
history, lease safety and two-user/workspace isolation. Also run the existing
summary resilience, scheduled recovery, automatic precall, shared-call access
and recap email suites, TypeScript and the production build.
