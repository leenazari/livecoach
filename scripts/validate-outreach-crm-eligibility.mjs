import assert from "node:assert/strict";
import {
  crmCompanyAllowsColdOutreach,
  outreachCrmBlockReason,
  prospectHasBlockedCrmRelationship,
} from "../lib/outreach-crm-eligibility.ts";

const openOpportunityCompanyIds = new Set(["new-but-engaged"]);

assert.equal(
  crmCompanyAllowsColdOutreach(
    { id: "new-lead", stage: "New" },
    openOpportunityCompanyIds
  ),
  true,
  "New CRM leads without an open opportunity should remain eligible"
);
assert.equal(
  crmCompanyAllowsColdOutreach(
    { id: "new-but-engaged", stage: "New" },
    openOpportunityCompanyIds
  ),
  false,
  "An open opportunity should block outreach even when the company stage is New"
);
for (const stage of ["Demo", "Dormant", "Partner", "", null]) {
  assert.equal(
    crmCompanyAllowsColdOutreach(
      { id: `blocked-${String(stage)}`, stage },
      openOpportunityCompanyIds
    ),
    false,
    `${String(stage || "Unclassified")} CRM companies should remain blocked`
  );
}

const guard = {
  eligibleCompanyIds: new Set(["new-lead"]),
  blockedCompanyIds: new Set(["demo", "dormant", "new-but-engaged"]),
  blockedDomains: new Set(["demo.example", "duplicate.example"]),
};

assert.equal(
  prospectHasBlockedCrmRelationship(
    {
      crm_company_id: "new-lead",
      company_domain: "new.example",
      email: "person@new.example",
    },
    guard
  ),
  false,
  "A prospect linked to a confirmed New lead should be eligible"
);
assert.equal(
  prospectHasBlockedCrmRelationship(
    {
      crm_company_id: "demo",
      company_domain: "demo.example",
      email: "person@demo.example",
    },
    guard
  ),
  true,
  "An engaged linked CRM company should be blocked"
);
assert.equal(
  prospectHasBlockedCrmRelationship(
    {
      crm_company_id: "unknown-company",
      company_domain: "unknown.example",
      email: "person@unknown.example",
    },
    guard
  ),
  true,
  "An unknown linked CRM company should fail closed"
);
assert.equal(
  outreachCrmBlockReason(
    {
      crm_company_id: "unknown-company",
      company_domain: "unknown.example",
      email: "person@unknown.example",
    },
    guard
  ),
  "linked_company_unavailable",
  "A missing safe company projection must identify the owner-access problem"
);
assert.equal(
  outreachCrmBlockReason(
    {
      crm_company_id: "demo",
      company_domain: "demo.example",
      email: "person@demo.example",
    },
    guard
  ),
  "linked_company_ineligible",
  "A visible non-New relationship must remain distinct from missing access"
);
assert.equal(
  prospectHasBlockedCrmRelationship(
    {
      crm_company_id: "new-lead",
      company_domain: "duplicate.example",
      email: "person@duplicate.example",
    },
    guard
  ),
  true,
  "A blocked duplicate company domain should override an eligible link"
);
assert.equal(
  prospectHasBlockedCrmRelationship(
    { company_domain: "unlinked.example", email: "person@unlinked.example" },
    guard
  ),
  false,
  "An unlinked domain without a blocked CRM relationship should remain eligible"
);

console.log("Outreach CRM eligibility checks passed");
