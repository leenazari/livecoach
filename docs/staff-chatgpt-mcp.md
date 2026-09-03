# LiveCoach staff ChatGPT connector

The production MCP endpoint is `https://www.livecoachcrm.com/mcp`.

## What staff can do

- Find one of their assigned leads by exact email
- List their assigned leads, 25 at a time
- Add one private lead assigned to themselves
- Add verified context without overwriting existing notes
- Create or reschedule their own follow-up
- List their own tasks, 25 at a time

The connector does not expose tools to send outreach, start or edit campaigns,
assign records to colleagues, change permissions, change code, delete records,
or read another salesperson's private work.

Every tool call creates an `mcp_action_receipts` row. Lead writes use the
existing exact email uniqueness rule. Every database call runs with the staff
member's OAuth access token so Postgres RLS remains the final authority.

## One-time owner setup

1. Apply `20260903002647_staff_chatgpt_mcp.sql`.
2. In Supabase Dashboard, open Authentication, then OAuth Server.
3. Enable the OAuth 2.1 server and dynamic client registration.
4. Set the consent path to `https://www.livecoachcrm.com/oauth/consent`.
5. Confirm the project uses asymmetric JWT signing. The MCP verifier rejects
   tokens it cannot verify with `getClaims`.
6. Deploy LiveCoach and verify all three public endpoints.

   - `https://www.livecoachcrm.com/mcp`
   - `https://www.livecoachcrm.com/.well-known/oauth-protected-resource/mcp`
   - `https://www.livecoachcrm.com/.well-known/oauth-authorization-server`

`LIVECOACH_MCP_ALLOWED_CLIENT_IDS` is optional. Once ChatGPT has dynamically
registered and its UUID is known, setting this comma-separated allowlist adds
another fail-closed client check. The consent page already allows only HTTPS
client and redirect hosts on `chatgpt.com` or `openai.com`.

`LIVECOACH_MCP_ACTIONS_PER_HOUR` optionally changes the per-user call cap. It
defaults to 120 and accepts values from 20 to 1000.

## ChatGPT workspace setup

ChatGPT currently makes custom apps with write actions available to Business,
Enterprise and Edu workspaces. A ChatGPT workspace owner completes this once.

1. In ChatGPT Workspace settings, open Permissions and roles, then Connected
   Data, and enable the custom MCP app developer setting for an authorised
   administrator.
2. Open Workspace settings, Apps, then Create.
3. Add `https://www.livecoachcrm.com/mcp` and scan the six tools.
4. Complete the OAuth test using the administrator's own LiveCoach login.
5. Review the write actions and publish LiveCoach to the approved staff group.

## Staff connection

Each salesperson then completes their own connection.

1. In ChatGPT, open Settings, Apps, then Enabled Apps.
2. Select LiveCoach and choose Connect.
3. Sign in using that salesperson's own LiveCoach login.
4. Review and approve the limited LiveCoach consent screen.

The grant can be revoked from the ChatGPT staff connector card in LiveCoach
Settings. Revocation invalidates that OAuth client's refresh tokens and future
MCP access.

## Acceptance checks

Use two non-owner test users before wider rollout.

1. Connect ChatGPT as salesperson A.
2. Add a unique test lead and confirm it is private, owned by A, and assigned to A.
3. Repeat the same email and confirm no duplicate appears.
4. Ask A to find a private lead owned by B and confirm it is not returned.
5. Add context and confirm the Outreach row shows the ChatGPT context badge.
6. Prepare outreach and confirm the verified staff context is included as
   reference data but cannot override campaign or safety instructions.
7. Create a follow-up and confirm it appears in A's Tasks and call-oriented lists.
8. Revoke A's grant and confirm the next MCP request receives an authentication error.
9. Confirm no staff tool exists for sending, campaign control, reassignment,
   deletion, permission changes, or code changes.
