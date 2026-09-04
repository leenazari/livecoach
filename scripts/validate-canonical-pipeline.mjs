import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const canonical = read("lib/canonical-opportunity.ts");
const exclusion = read("lib/company-pipeline-exclusion.ts");
const updateProfile = read("app/api/crm/update-profile/route.ts");
const synthesize = read("app/api/crm/companies/[id]/synthesize/route.ts");
const commercialUpdate = read("app/api/crm/calls/[id]/commercial-update/route.ts");
const revenue = read("app/api/crm/revenue/route.ts");
const companyPipeline = read("app/api/crm/companies/[id]/pipeline/route.ts");
const companyPage = read("app/crm/[id]/page.tsx");
const brain = read("app/api/crm/assistant/route.ts");
const authority = read("lib/brain-authority.ts");
const inbox = read("app/api/crm/inbox/route.ts");
const dashboard = read("app/api/crm/dashboard/route.ts");
const migration = read(
  "supabase/migrations/20260828173307_canonical_open_revenue_opportunity_per_workstream.sql"
);

// All creation paths reuse the canonical company or workstream deal instead of
// manufacturing one active row for every AI-suggested use case.
assert.match(canonical, /loadCanonicalOpenRevenueOpportunity/);
assert.match(canonical, /createCanonicalOpenRevenueOpportunity/);
assert.match(canonical, /error as any\)\?\.code === "23505"/);
assert.match(updateProfile, /opportunities: 0-1/);
assert.match(updateProfile, /\.slice\(0, 1\)/);
assert.match(updateProfile, /createCanonicalOpenRevenueOpportunity/);
assert.doesNotMatch(
  updateProfile,
  /from\("opportunities"\)[\s\S]{0,180}\.delete\(/
);
assert.match(synthesize, /opportunities: 0-1/);
assert.match(synthesize, /\.slice\(0, 1\)/);
assert.match(synthesize, /createCanonicalOpenRevenueOpportunity/);
assert.doesNotMatch(
  synthesize,
  /from\("opportunities"\)[\s\S]{0,180}\.delete\(/
);
assert.match(commercialUpdate, /chooseCanonicalOpenRevenueOpportunity/);
assert.match(commercialUpdate, /context\.call\.workstream_id/);
assert.match(commercialUpdate, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(commercialUpdate, /assigned_to_user_id\.eq\.\$\{scope\.userId\}/);
assert.match(companyPipeline, /export async function POST/);
assert.match(companyPipeline, /loadAssignedClientAccess/);
assert.match(companyPipeline, /createCanonicalOpenRevenueOpportunity/);
assert.match(companyPipeline, /surfacedByAi: false/);
assert.match(companyPage, /Add to my pipeline/);
assert.match(companyPage, /\/api\/crm\/companies\/\$\{id\}\/pipeline/);
assert.match(brain, /if \(it\.type === "promote_to_pipeline"\)/);
assert.match(brain, /Only a canonical opportunity record means a client is in the pipeline/);
assert.ok(authority.includes("promote_to_pipeline: ["));
assert.ok(
  authority.includes("/^\\/api\\/crm\\/companies\\/[0-9a-f-]+\\/pipeline$/i")
);

// Every primary sales read obeys an explicit company-level exclusion.
assert.match(exclusion, /companyPipelineExclusionIds/);
assert.match(revenue, /companyPipelineExclusionIds/);
assert.match(revenue, /!pipelineExcludedCompanyIds\.has/);
assert.match(inbox, /activeOpportunities/);
assert.match(inbox, /opportunities: activeOpportunities/);
assert.match(dashboard, /companyPipelineExclusionIds/);
assert.match(dashboard, /\.eq\("owner_id", accountScope\.userId\)/);

// The database is the final concurrency guard. Legacy duplicates are archived,
// not erased, and a different explicit workstream can still own its own deal.
assert.match(migration, /status = 'dismissed'/);
assert.doesNotMatch(migration, /delete from public\.opportunities/i);
assert.match(migration, /partition by company_id, workstream_id/);
assert.match(migration, /opportunities_one_open_revenue_per_scope_idx/);
assert.match(migration, /where company_id is not null[\s\S]*status = 'open'[\s\S]*opportunity_type = 'revenue'/);

console.log("Canonical pipeline creation, exclusion and database guard checks passed");
