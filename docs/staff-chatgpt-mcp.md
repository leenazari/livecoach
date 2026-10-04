# LiveCoach staff ChatGPT connector

The production MCP endpoint is `https://www.livecoachcrm.com/mcp`.

## What staff can do

Each person connects ChatGPT using their own LiveCoach login. Every CRM query uses their OAuth token, workspace and owner ID. Assigned lead reads are also limited to that person's assignment. Even workspace managers cannot use this connector to query another user's private records.

- Query and search their tasks, campaigns, marketing leads, assigned sales leads, companies, contacts, opportunities, call summaries, calendar, documents, Brain history and learnings, profile, email drafts, and their own saved Analytics snapshot.
- Read their own connected Google or Microsoft mailbox through the existing account-specific mail helpers. Provider limits and stripped reply chains are labelled.
- Create personal tasks and marketing plans with deadlines, success measures and replayable coaching.
- Complete, reopen, reschedule or add notes to their own tasks. A version check and database comparison prevent stale updates.
- Create and update their own campaign records and marketing lead details. This does not launch advertising or spend money. Lead creation remains unassigned until handover in LiveCoach.
- Append notes to their own companies, contacts and marketing leads without overwriting existing context.
- Use the original personal lead and follow-up tools.

The connector does not send email or outreach, launch campaigns, change budgets in advertising providers, assign colleagues, delete records, alter call transcripts, edit historical Brain conversations, change permissions, or change code. Read-only historical records remain read-only. Linked ChatGPT conversations are not automatically imported into LiveCoach.

Every call returns an audit receipt. Create requests use reusable IDs to prevent duplicate tasks, campaigns and marketing leads. Lists report totals and page boundaries; long content includes truncation labels. Tokens, signing keys and other users' connector credentials are never returned.

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

Existing connections must refresh tools in ChatGPT to discover the expanded surface. Do not reconnect using Lee's login for a staff member.

Revoke the grant from the ChatGPT connector card in LiveCoach Settings. This stops future MCP access and invalidates the client's refresh grant.

## Acceptance checks

Run the staff MCP and personal MCP validation scripts. The personal tests exercise two users and two workspaces against a deliberately broad database mock, so ownership must be enforced by the tools themselves as well as RLS. They cover reads, blocked foreign writes, stale versions, task replay, omitted-field preservation, note append behaviour and exact mailbox owner binding.

Before granting broader staff access, complete one connection as each staff account and confirm that revocation and live account membership checks remain effective.
