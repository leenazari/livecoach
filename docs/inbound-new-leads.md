# New leads and inbound integration

The `New leads` sidebar item opens `/crm/new-leads`. Inbound enquiries live in a dedicated queue, not `outreach_prospects`, the CSV pool, or the ordinary marketing handover queue. The owner retains access. One enabled marketing reviewer can also review them. No user, reviewer, credential, sample row or incoming traffic is enabled by the migration.

The sample view is browser-local fictional data for design review. Status and handover changes in sample view never write CRM records or send messages. Live status changes require a current row version. An explicit handover requires `ready`, a note and an approved active salesperson. That atomic operation creates one sales-visible `marketing_leads` record with phone and reviewed qualification. A retry cannot create a second handover. It creates no cold outreach enrolment or messages.

## Install and review

1. Run `pnpm install --frozen-lockfile` and `pnpm validate:inbound-leads`, `pnpm exec tsc --noEmit`, plus the existing marketing/personal MCP checks.
2. Apply `supabase/migrations/20261015191202_inbound_new_leads_api.sql` to the intended LiveCoach database. It is additive and seeds no access or configuration. Apply it before releasing the application, because the existing sales handover UI now selects the added phone/context columns.
3. Deploy through the repository PR workflow. The owner opens New leads and tries Sample view. Check desktop, mobile, details, filters, dropdowns and handover. Do not enable intake during design review.
4. Later, in `/settings/inbound-leads`, choose the verified marketing account and approved sales recipients, then enable access. Lee owns LiveCoach changes with ChatGPT; Jay coordinates external services; Nicara owns campaign setup/content.
5. Create one expiring credential per service with only its required scopes, sources and event types. Keys are shown once; only SHA-256 hashes are stored. Revoke or rotate from Setup. No cron or Supabase service secret belongs in an automation tool.

## External API

All requests use `Authorization: Bearer <scoped connection key>`. JSON bodies are limited to 64 KB. Requests are bound to the key's workspace, scopes and sources. API inputs cannot choose a workspace, reviewer, salesperson or lead status. A key also requires its creating owner and the configured reviewer to remain active. Disabled intake denies all integration access. No Meta, WhatsApp, telephony or email service is provisioned by this change.

| Endpoint | Scope | Purpose |
| --- | --- | --- |
| `POST /api/integrations/marketing/leads` | `leads:create` | Create a new unassigned inbound enquiry |
| `GET /api/integrations/marketing/leads/{id}` | `leads:read` | Read the scoped lead and current `contactAllowed` flags |
| `PATCH /api/integrations/marketing/leads/{id}` | `leads:update` | Append structured AI qualification with an expected version |
| `POST /api/integrations/marketing/events` | `events:write` plus the event type | Record delivery, call, booking or activation evidence |

Example intake body, using fictional details:

```json
{
  "source": "facebook",
  "sourceLeadId": "stable-meta-lead-id",
  "companyName": "Example business",
  "contactName": "Alex Example",
  "contactEmail": "alex@example.com",
  "contactPhone": "+447700900123",
  "businessType": "Recruitment",
  "companySize": "11 to 50",
  "need": "Screen 60 applicants each month",
  "sourceDetails": {"formId": "meta-form", "campaignId": "meta-campaign", "adId": "meta-ad"},
  "consent": {
    "whatsapp": {"granted": true, "capturedAt": "2026-10-15T10:00:00Z", "wording": "Exact wording shown to this lead", "version": "1"}
  }
}
```

The AI-call permission is separate, under `consent.aiCall`, with the same shape. Missing permission means no permission. The API records the supplied evidence; it does not independently prove consent. Validate campaign wording and source evidence before launch.

Intake returns `{ "leadId": "uuid", "created": true, "version": 1 }`. Repeating the same source/lead ID and identical parsed body returns the original ID. Reusing the ID with changed data is a conflict. Different source IDs for the same phone/email remain separate enquiries with `duplicate_of` flagged for review, preserving campaign attribution. They are never matched into the CSV/outreach pool.

Qualification example:

```json
{
  "requestId": "unique-call-result-id",
  "expectedVersion": 1,
  "qualification": {
    "businessProcess": "Manual first-round calls",
    "monthlyVolume": "60 applicants",
    "currentSystems": "Customer-stated system",
    "timeline": "This quarter",
    "recommendedProduct": "AI screening",
    "recommendationReason": "Customer confirmed a screening bottleneck",
    "preferredRoute": "demo",
    "callSummary": "Customer-confirmed context, with unknowns left empty"
  }
}
```

The full supported field list is in `qualificationSchema` in `lib/inbound-leads.ts`. `preferredRoute` accepts `demo`, `self_service` or `human_review`. Machine updates never approve, assign, change contact evidence or rewrite the original campaign.

Event example:

```json
{
  "eventId": "stable-provider-event-id",
  "leadId": "lead-uuid",
  "type": "trial.registered",
  "occurredAt": "2026-10-15T10:30:00Z",
  "details": {"providerReference": "verified-registration-reference", "product": "Interviewa"}
}
```

Allowed event types are listed in `INBOUND_EVENTS`. Each credential must be permitted to record the individual type. A provider-facing adapter must verify the provider signature before forwarding an event with the LiveCoach bearer credential; these endpoints do not claim to implement Meta or Twilio signature adapters. Events are append-only and use their original occurrence time in the timeline. A late event never reopens an opt-out. Bookings, registrations, human takeover, opt-outs, rejection and sales handover stop automated chasing. Tokens and account creation remain the product website's responsibility; recording `trial.tokens_granted` does not issue credits.

An automation tool must GET the current lead and check `contactAllowed` immediately before contact. Missing, false, disabled, error or handed-over state means do not send or call. The Facebook Instant Form does not open a WhatsApp customer-service window; business-initiated video needs a permitted, approved template.

## Retries and errors

- `400`: correct invalid fields or configuration. `401/403`: repair credentials or permissions; do not retry unchanged.
- `404`: inaccessible or missing record. Cross-workspace records return no data.
- `409`: ID collision, stale version or a closed lead. Preserve request IDs on uncertain retries; fetch the current version before a genuinely new update. Do not change a previously used request's payload.
- `429`: wait at least one minute. Each key is limited to 120 successful operations per minute, enforced in the database.
- `503`: intake is disabled or the migration is missing. No live integration is ready in that state.
- `5xx` or transport uncertainty: retry the exact operation with the same source, request or event ID and exponential backoff. Do not manufacture a new ID.

Creation, qualification receipts, event receipts and handover are transactional PostgreSQL operations. Credentials are rechecked on every operation. Internal request headers are never accepted as integration authentication. Database RLS separately denies the intake to salespeople, unrelated marketers, inactive users and other workspaces. Workspace owners can always review their own workspace's history, including while intake is paused.
