# Assigned new leads

`/crm/new-leads` defaults to the assigned sales list. Existing inbound review is a separate owner/reviewer-only view behind **Inbound enquiries**. This does not require the inbound intake migration or enable incoming AI calls, WhatsApp or outreach.

## Canonical data and access

- Companies and contacts remain the records of truth. `team_client_shares.assigned_to_user_id` is the operational salesperson, not `companies.owner_id`, which protects private history.
- The new API rechecks active membership in the database. Only a verified workspace owner can see all assigned imported leads. Every other member sees their exact active assignments, including marketing users. Managers do not gain an all-user view.
- Confidential, investor, internal, personal, protected partner and archived companies are excluded. Revoking the share immediately removes the lead from this view. No team-cover or fuzzy identity fallback is used.
- A narrow projection returns permitted source notes and links only. Existing company notes, profile, mailbox context, commercial memory and unrelated contact attributes are never returned by the new API.
- Contact names and details are read from canonical contacts. Source-only information lives in `companies.attributes.importedLead`. Only `contactIds` references are kept there, not a second copy of people or assignments.
- Source contact status and source email dates are labelled as spreadsheet information. They are not fabricated CRM send receipts. Current CRM stage remains independent and is preserved on existing clients.
- UI pages are 25 rows. Server reads are scoped first and chunked to avoid PostgREST row limits. No AI research or messaging happens during loading or import.
- Newest source date comes first, with newer source rows first on the same day and import time as a fallback. Users can choose oldest first or company A–Z. Quick views cover not contacted, follow-ups and missing details. Additional filters cover status, demo availability/opened, contact channel and owner. Counts use only the authorised user's data. Do-not-contact and not-interested records never appear in actionable quick views. Follow-ups are labelled as source-contacted leads, not invented due dates.

## Adam daily leads import

Source spreadsheet `1J7AzUwaTJNSbUxoDs0BCQLvLOrTZXxPN8oqSHrnD0FU`, tab **Leads**, gid `1366583743`. Do not read or import the other tab without a new request.

The Owner column is the assignee. Match it to one active workspace member and stop on unknown or ambiguous names. Preserve company, website, named contact, role, LinkedIn, signal and evidence URL, status, notes, phone, email from O, the important demo/holding URL in P, page status in S, sent-date history in X, restrictions in Y and demo activity in Z. **Ignore I, J, Q, R, T, U, V and W.** Do not generate outreach from ignored draft columns.

Use `sheetLeadMapping` in `lib/lead-sheet-import.ts`. Its stable source reference uses sheet ID and normalized company domain or name, not row position. Reordering the sheet must not create duplicates. Keep generic company inboxes in `attributes.leadEmail`; do not claim that an `info@` address is a named person's personal address. Add a contact email only where the source clearly identifies that person. Multiple people receive separate contact records. Do not invent names or email addresses.

### Reviewed atomic import procedure

1. Read the bounded populated sheet range through the connected Sheets tool. Compare source references against canonical imported company records. Daily runs process **new rows only**, without rewriting previously imported source or CRM work.
2. Refresh active membership, exact company domain/name and exact contact/email matches in this workspace. Inspect ambiguous matches and protected classifications. Existing matches are reused, never silently merged or duplicated. Preserve their privacy owner and private content.
3. Keep a before-image outside the repository of fields that will change, current timestamps, shares and hashes of private content. Do not commit customer data or credentials.
4. Build a reviewed plan with workspace ID, verified owner actor ID, canonical company IDs, expected timestamps and owner IDs, contact IDs, safe metadata, and matching existing prospect IDs. New IDs are UUIDs. Link existing prospects instead of duplicating them. Only reassign a matched prospect after confirming it has no enrolments or messages. If it has activity, leave it untouched and report it for review.
5. `scripts/lib/sheet-lead-import-sql.mjs` exports `sheetLeadImportSql(plan)`. It only builds SQL and has no database credentials or network client. Rehearse the generated block inside `BEGIN` / `ROLLBACK` through the authorised database connection. A missing member, changed row, protected company, new duplicate, conflicting link or outreach activity aborts the whole batch.
6. Apply the same reviewed block atomically. It preserves company privacy owners, stages and histories, merges source metadata, fills only missing contact core fields, writes the canonical salesperson assignment and links safe existing prospects. Source-contacted prospects are not reset to fresh cold leads. Do-not-contact and not-interested restrictions are retained. No new prospect, campaign, enrolment, message or AI job is created.
7. Re-read every imported source reference. Verify counts by assignee, exact demo URLs, canonical contact links, existing privacy hashes, workspace IDs and restrictive statuses. Verify no messages or enrolments were created. A replay skips existing source references, including later manual CRM edits.

The daily 10am Europe/London run is a Codex recurring task, not an application cron. It uses the same connectors and reviewed, owner-scoped procedure. Do not invent credentials, weaken RLS, scrape private data or create a second authoritative lead table to automate it. Unknown owners and protected or ambiguous matches are skipped and reported, not guessed.

## Checks

- `npm run validate:assigned-new-leads` covers real server loader and API logic with two-user/owner/marketing isolation, stale roles, inactive membership, foreign workspace, protected records, hidden fields, filter validation and read failures. PGlite executes the generated SQL to verify atomic rollback, unchanged private history, idempotency, duplicate guards and in-flight outreach protection.
- Existing inbound, team-lead-cover and marketing-workspace validators remain applicable.
- Run TypeScript and the production build. Do not deploy private import plans or before-images.
