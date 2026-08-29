import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const [migration, reconciliation, orchestration, integration, reviewsRoute, settings] =
  await Promise.all([
    read("supabase/migrations/20260828235614_next_moves_email_sendpilot_guard.sql"),
    read("lib/sendpilot-reconciliation.ts"),
    read("lib/sendpilot-outreach.ts"),
    read("lib/sendpilot.ts"),
    read("app/api/crm/sendpilot/reviews/route.ts"),
    read("app/settings/page.tsx"),
  ]);

assert.match(
  migration,
  /unique index sendpilot_lead_links_workspace_linkedin_once_idx[\s\S]*?\(workspace_id, linkedin_url\)/
);
assert.match(
  migration,
  /unique index sendpilot_lead_links_workspace_email_once_idx[\s\S]*?\(workspace_id, lower\(email\)\)/
);
assert.match(migration, /create table public\.sendpilot_lead_reviews/);
assert.match(migration, /'missing_linkedin'/);
assert.match(migration, /unique \(integration_id, sendpilot_lead_id\)/);
assert.match(migration, /alter table public\.sendpilot_lead_reviews enable row level security/);
assert.match(
  migration,
  /revoke all on public\.sendpilot_lead_reviews, public\.email_assistant_drafts[\s\S]*?from public, anon, authenticated/
);
assert.doesNotMatch(migration, /grant select[\s\S]*?to authenticated/);

assert.match(reconciliation, /prospectsByLinkedIn/);
assert.match(reconciliation, /prospectsByEmail/);
assert.match(reconciliation, /remoteProfileUrl/);
assert.match(reconciliation, /reviewReason = "missing_linkedin"/);
assert.match(reconciliation, /linkedinProspect\.id !== emailProspect\.id/);
assert.match(reconciliation, /prospect\?\.assigned_to_user_id !== integration\.owner_id/);
assert.match(reconciliation, /existing\.outreach_prospect_id !== prospect\.id/);
assert.match(reconciliation, /reviewReason = "workspace_duplicate"/);
assert.match(reconciliation, /pauseLiveCoachEmailOutreachForSendPilot/);
assert.match(reconciliation, /\.in\("status", \["draft", "approved"\]\)/);
assert.match(reconciliation, /status: "paused"/);
assert.match(reconciliation, /status: "cancelled"/);

assert.match(orchestration, /activeSendPilotConflictForProspect/);
assert.match(orchestration, /pauseLiveCoachEmailOutreachForSendPilot/);
assert.match(
  orchestration,
  /This person is already tracked by a SendPilot account in this workspace/
);
assert.match(integration, /createContactWhenUnmatched: false/);
assert.match(integration, /reconcileSendPilotLeads/);
assert.match(integration, /sendpilot_lead_reviews/);
assert.match(reviewsRoute, /requireRequestScope/);
assert.match(reviewsRoute, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(reviewsRoute, /\.eq\("owner_id", scope\.userId\)/);
assert.match(settings, /SendPilot leads waiting for an exact CRM match/);
assert.match(settings, /No CRM lead was created/);

const leads = [
  { owner: "lee", email: "same@example.com", linkedin: "linkedin.com/in/same" },
  { owner: "cam", email: "same@example.com", linkedin: "linkedin.com/in/same" },
];
const uniqueByWorkspaceIdentity = new Set(
  leads.map((lead) => `${lead.email}|${lead.linkedin}`)
);
assert.equal(uniqueByWorkspaceIdentity.size, 1);

console.log("SendPilot workspace identity guard and review queue checks passed");
