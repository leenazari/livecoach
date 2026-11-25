# Pipeline email history

The pipeline table, mobile cards and Kanban cards have an **Email thread · Latest 12** button. It opens the existing deal workspace directly to the email tab. Deal editing remains a separate tab.

- Read the latest 12 sent and received messages with the selected lead, across subjects, newest first. This is contact correspondence, not 12 separate threads or a generated summary.
- On-demand reads only. Opening the pipeline list does not fetch emails. Opening the email tab reads the signed-in user's currently connected Google or Microsoft mailbox. Refresh performs another read.
- Exact canonical contact IDs and email addresses only. Ordinary clients use the actor's own contact records. Assigned imported leads can use the already-authorised safe lead projection. Several valid contacts require an explicit choice. No arbitrary browser-supplied address, company-domain search or fuzzy name search is accepted.
- Company access and active workspace membership are rechecked. Shared access never permits reading a teammate's mailbox or private contact book. Confidential and protected relationships stay inaccessible to teammates. Own account addresses are excluded so a self-contact cannot match the whole inbox.
- At most 12 message bodies are fetched in parallel under the same 15-second deadline as the metadata search. Existing plain-text conversion removes quoted older replies and caps each message at 8,000 characters. Failed body reads retain only a clearly labelled preview. Search failure, no matching messages, missing contact and disconnected mailbox are distinct states.
- No AI, email sending, email drafting, database writes, mailbox sync, duplicate transcript/source storage or new background work. The saved-CRM fallback remains available and is also capped at 12 messages.
- Existing body-reader callers retain their best-effort behaviour. Only this explicit history read opts into strict failures and bounded request signals.

## Validation

`node scripts/validate-sales-history-navigation.mjs` exercises the real contact resolver, recorded-message loader, mailbox history, provider adapters, endpoint and React components with deterministic fixtures. It covers 0, fewer than 12 and more than 12 messages, duplicates, sorting, exact addresses, two users, foreign workspaces, inactive membership, denied/protected companies, malformed source and contact selection, missing mailbox, partial body failures, safe text rendering, stale responses, lazy pipeline reads and both pipeline layouts.

No migration is required. Authenticated live mailbox contents are not used by the fixture tests.
