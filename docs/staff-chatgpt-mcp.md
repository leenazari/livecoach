# LiveCoach staff ChatGPT connector

The production MCP endpoint is `https://www.livecoachcrm.com/mcp`.

## What staff can do

Each person connects ChatGPT using their own LiveCoach login. Every request uses their verified OAuth identity and workspace. Personal tools query their owned or explicitly assigned work. The Brain tools reuse the existing Brain engine and its normal role, shared-work, team-cover, assignment and trust policies. This does not grant access to another person's private records or connected accounts.

- Query and search their tasks, campaigns, marketing leads, assigned sales leads, companies, contacts, opportunities, call summaries, calendar, documents, Brain history and learnings, profile, email drafts, and their own saved Analytics snapshot.
- Read their own connected Google or Microsoft mailbox through the existing account-specific mail helpers. Provider limits and stripped reply chains are labelled.
- Create personal tasks and marketing plans with deadlines, success measures and replayable coaching.
- Complete, reopen, reschedule or add notes to their own tasks. A version check and database comparison prevent stale updates.
- Create and update their own campaign records and marketing lead details. This does not launch advertising or spend money. Lead creation remains unassigned until handover in LiveCoach.
- Append notes to their own companies, contacts and marketing leads without overwriting existing context.
- Use the original personal lead and follow-up tools.
- Ask the existing Brain for advice, coaching or any normal Brain action through `ask_my_brain`. Each turn and its result are saved in their own Brain history.
- Review the exact signed proposal before `execute_my_brain_action`. The existing executor checks current role, Brain trust rules, assigned work, provider account, suppression and approval requirements. External messages, calendar changes, paid work and destructive changes always require separate approval.
- Check their own execution receipts with `get_my_brain_execution` and undo eligible reversible actions through the existing ten-minute undo handler with `undo_my_brain_action`.

The Brain bridge can carry out the actions the same user can approve in the existing Brain, including account-bound email sends and calendar changes. Owner-only actions remain owner-only; member import grants remain required. The personal record tools retain their narrower limits. No tool changes application code, roles, credentials, permissions or immutable audit history, or bypasses another person's private connections. Advertising launch and ad-provider budget changes are not existing Brain actions and remain unavailable. Linked ChatGPT conversations are not automatically imported; only explicitly delegated Brain turns and action results are saved.

Every call returns an audit receipt. Create requests use reusable IDs to prevent duplicate tasks, campaigns and marketing leads. Brain turns use a reusable requestId and return the same prepared result on transport retry. Execution retries reuse the original signed Brain token and the existing execution ledger. Lists report totals and page boundaries; long content includes truncation labels. Tokens, signing keys and other users' connector credentials are never returned.

## One-time owner setup

1. Apply `20260903004101_staff_chatgpt_mcp.sql`.
2. In Supabase Dashboard, open Authentication, then OAuth Server.
3. Enable the OAuth 2.1 server and dynamic client registration.
4. Set the consent path to `https://www.livecoachcrm.com/oauth/consent`.
5. Confirm the project uses asymmetric JWT signing. The MCP verifier rejects
   tokens it cannot verify with `getClaims`.
6. Deploy LiveCoach and verify all three public endpoints.

   - `https://www.livecoachcrm.com/mcp`
   - `https://www.livecoachcrm.com/.well-known/oauth-protected-resource/mcp`
   - `https://www.livecoachcrm.com/.well-known/oauth-authorization-server`

The protected-resource metadata advertises `offline_access`. Supabase issues
rotating refresh tokens so ChatGPT can keep the connection active without
asking staff to sign in again whenever the short-lived access token expires.

`LIVECOACH_MCP_ALLOWED_CLIENT_IDS` is optional. Once ChatGPT has dynamically
registered and its UUID is known, setting this comma-separated allowlist adds
another fail-closed client check. The consent page already allows only HTTPS
client and redirect hosts on `chatgpt.com` or `openai.com`.

`LIVECOACH_MCP_ACTIONS_PER_HOUR` optionally changes the per-user call cap. It
defaults to 120 and accepts values from 20 to 1000.

## ChatGPT connection

Official setup reference: https://developers.openai.com/api/docs/guides/developer-mode

Developer mode is available on the web for Plus, Pro, Business, Enterprise and Education accounts. Managed workspaces may restrict who can create or use the connection.

1. In ChatGPT web, open Settings, Security and login, and enable Developer mode.
2. In ChatGPT Plugins, choose the plus button and add the MCP address shown in LiveCoach Settings, with OAuth authentication.
3. Sign in with your own LiveCoach account and review the consent screen.
4. Select LiveCoach for the conversation. Try “Give me my to-do list” or “Show my marketing campaigns”.
5. Read the current record before requesting changes. Review write actions in ChatGPT before approving.
6. For a managed team, an authorised administrator can publish the connection to the approved staff group using the workspace's available plugin controls.

This extends the same existing MCP server, not a second connector. Existing connections must refresh tools in ChatGPT to discover the expanded surface. Do not reconnect using Lee's login for a staff member.

Revoke the grant from the ChatGPT connector card in LiveCoach Settings. This stops future MCP access and invalidates the client's refresh grant.

## Acceptance checks

Run the staff MCP and personal MCP validation scripts. The personal tests exercise two users and two workspaces against a deliberately broad database mock, so ownership must be enforced by the tools themselves as well as RLS. They cover reads, blocked foreign writes, stale versions, task replay, omitted-field preservation, note append behaviour and exact mailbox owner binding.

Before granting broader staff access, complete one connection as each staff account and confirm that revocation and live account membership checks remain effective.

## Brain bridge implementation and checks

The authenticated MCP principal is carried in request-local AsyncLocalStorage while the original Brain route handlers run in-process. This is user context, never a service-session impersonation. It cannot be selected through tool arguments, headers, cookies or a URL. The user-scoped Supabase client retains OAuth RLS; existing narrowly scoped service operations retain their own permission checks. Nested Brain actions dispatch only fixed, allowlisted route modules, avoiding cookie fabrication or a broad bearer-auth exception in middleware. Browser requests keep their existing transport.

Run `validate:brain-mcp` plus the existing staff MCP, personal MCP, Brain controlled-authority and Brain sales-scope checks. The new tests cover concurrent identities, original handler reuse, role-blocked delegation, token identity and role binding, edited review denial, exact provider content review, action retries, trust blocks, foreign receipts and undo.

## Private Brain relationships and owner auditing

Raw conversation history, routine responses and action results are account-private in the application, connector and database, including records formerly labelled team. Explicitly approved shared CRM work and team learning retain their normal role permissions; they do not grant access to another person's raw Brain conversations.

The separate `/crm/brain-audit` screen is available only to an active workspace owner. Server-side audit copies capture new Brain requests, replies, proposed actions, confirmed outcomes and failures in both LiveCoach and ChatGPT. Credentials and execution/signing tokens are redacted; content limits are labelled. No audit copies are sent to ordinary Brain context or MCP tools. Personal Brain history and memory continue independently.

Apply `20261004191900_brain_role_connector_private_audit.sql`. Audit expiry is fixed at 720 hours; authenticated owners cannot read expired entries. The production cron `/api/cron/brain-audit-retention` runs hourly at minute 7 with the existing `CRON_SECRET`, deleting expired audit copies only. Audit rows are append-only for application accounts and the service cannot update them. No backfill of older conversations is performed.
