import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { opportunityProposalNeedsConfirmation } from "../lib/opportunity-scope-guard.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

assert.equal(
  opportunityProposalNeedsConfirmation(
    {
      title: "UK Platinum October rollout",
      detail: "Roll out Interviewa to nine staff",
      session_id: "call-1",
    },
    {
      title: "UK Platinum October rollout",
      detail: "Roll out Interviewa to nine staff",
    }
  ),
  false,
  "An exact repeat must reuse the canonical deal without interrupting the user"
);

assert.equal(
  opportunityProposalNeedsConfirmation(
    { title: "Existing deal", session_id: "call-1" },
    { title: "Different wording", sessionId: "call-1" }
  ),
  false,
  "Reprocessing the same source event must remain idempotent"
);

assert.equal(
  opportunityProposalNeedsConfirmation(
    {
      title: "Candidate training rollout",
      detail: "Recruiter candidate interview preparation for the October team rollout",
    },
    {
      title: "October training expansion",
      detail: "Candidate interview preparation for the recruiter team rollout",
    }
  ),
  false,
  "Clearly overlapping evidence must remain one buying decision"
);

assert.equal(
  opportunityProposalNeedsConfirmation(
    {
      title: "Candidate training rollout",
      detail: "Recruiter interview preparation for a delivery team",
    },
    {
      title: "Admissions screening licence",
      detail: "University admissions screening for a separate department",
    }
  ),
  true,
  "A materially different buying decision must stop for human confirmation"
);

assert.equal(
  opportunityProposalNeedsConfirmation(
    {
      title: "Interviewa candidate training rollout",
      detail: "Prepare recruiters and candidates for technology placements",
    },
    {
      title: "Interviewa candidate screening rollout",
      detail: "Automate volume screening for a separate admissions department",
    }
  ),
  true,
  "Shared product language must not merge separate buying decisions"
);

const canonical = read("lib/canonical-opportunity.ts");
const updateProfile = read("app/api/crm/update-profile/route.ts");
const synthesize = read("app/api/crm/companies/[id]/synthesize/route.ts");
const inboxApi = read("app/api/crm/inbox/route.ts");
const inboxPage = read("app/crm/inbox/page.tsx");
const resolver = read("app/api/crm/opportunity-clarifications/[id]/route.ts");
const brainContext = read("lib/crm-context.ts");
const brainRoute = read("app/api/crm/assistant/route.ts");
const migration = read(
  "supabase/migrations/20260828173307_canonical_open_revenue_opportunity_per_workstream.sql"
);

assert.match(canonical, /opportunityProposalNeedsConfirmation/);
assert.match(canonical, /kind: "opportunity_clarification"/);
assert.match(canonical, /ownerId = actor\.userId/);
assert.match(canonical, /confirmationRequired: !!clarification/);
assert.match(canonical, /draft\.sessionId \|\| draft\.workstreamId/);
assert.match(canonical, /taskStatus !== "open"/);
assert.match(updateProfile, /opportunityConfirmation/);
assert.match(synthesize, /opportunityConfirmation/);
assert.match(inboxApi, /clarificationType === "opportunity_scope"/);
assert.match(inboxPage, /Same deal/);
assert.match(inboxPage, /Separate deal/);
assert.match(inboxPage, /Not a deal/);
assert.match(resolver, /\.eq\("owner_id", account\.userId\)/);
assert.match(resolver, /source_channel: "opportunity_scope_confirmation"/);
assert.match(resolver, /event_type: "updated"/);
assert.match(resolver, /clarificationTaskId: task\.id/);
assert.match(resolver, /createdForThisQuestion/);
assert.match(resolver, /\.contains\("evidence", \{ clarificationTaskId: task\.id \}\)/);
assert.match(resolver, /duplicateName\.visibility !== "team"/);
assert.match(resolver, /duplicateName\.owner_id !== account\.userId/);
assert.match(brainContext, /PENDING PIPELINE CONFIRMATIONS/);
assert.match(brainContext, /task\.owner_id === requestScope\.userId/);
assert.match(brainRoute, /resolve_opportunity_clarification/);
assert.match(brainRoute, /\.eq\("owner_id", requestScope\.userId\)/);
assert.match(brainRoute, /Never infer the answer/);
assert.match(brainRoute, /"resolve_opportunity_clarification",/);
assert.match(migration, /opportunities_one_open_revenue_per_scope_idx/);
assert.match(migration, /where company_id is not null[\s\S]*status = 'open'[\s\S]*opportunity_type = 'revenue'/);

console.log("Opportunity confirmation gate validation passed");
