import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const form = read("components/crm/ClientPortfolio.tsx");
const board = read("app/crm/board/page.tsx");
const contacts = read("app/api/crm/contacts/route.ts");
const outreach = read("app/api/crm/outreach/route.ts");

assert.match(form, /export type NewClientInput = \{[\s\S]*?companyName: string;[\s\S]*?firstName: string;[\s\S]*?lastName: string;[\s\S]*?email: string;[\s\S]*?jobTitle: string;[\s\S]*?recordType: "prospect" \| "relationship";[\s\S]*?relationshipStage: string;/);
assert.match(form, /Company and primary contact/);
assert.match(form, /Contact first name/);
assert.match(form, /Exact work email/);
assert.match(form, /New sales prospect/);
assert.match(form, /Existing client or relationship/);
assert.match(form, /!newClient\.companyName\.trim\(\)[\s\S]*?!newClient\.firstName\.trim\(\)[\s\S]*?!newClient\.email\.trim\(\)/);
assert.match(form, /appear in Clients and the person will also appear in Outreach/);
assert.match(form, /Nothing is researched, enrolled, or sent automatically/);
assert.match(form, /appear in Clients only/);
assert.match(form, /not silently added to cold Outreach/);

const createFlow = board.match(/const createCompany = async \(input: NewClientInput\): Promise<boolean> => \{[\s\S]*?\n  \};\n  const deleteCompany/)?.[0] || "";
assert.ok(createFlow, "complete client creation flow is present");
assert.match(createFlow, /input\.recordType === "prospect"[\s\S]*?\? "New"/);
assert.match(createFlow, /already exists as[\s\S]*?No duplicate contact or cold-outreach prospect was created/);
assert.ok(
  createFlow.indexOf('"/api/crm/outreach"') < createFlow.indexOf('"/api/crm/contacts"'),
  "a prospect email is reserved and deduplicated before the contact is written"
);
assert.match(createFlow, /outreachResult\.prospect\.crm_company_id !== company\.id/);
assert.match(createFlow, /contactResult\.contact\.company_id !== company\.id/);
assert.match(createFlow, /await load\("clients"\)/);
assert.match(createFlow, /Nothing was researched, enrolled, or sent/);
assert.match(createFlow, /They were not added to cold Outreach/);
assert.doesNotMatch(createFlow, /research_jobs|outreach_enrolments|outreach_messages|\/send/);

assert.match(contacts, /\.from\("contacts"\)[\s\S]*?\.eq\("workspace_id", scope\.workspaceId\)[\s\S]*?\.ilike\("email", exactIlikePattern\(email\)\)/);
assert.match(contacts, /code: "contact_email_owned_by_teammate"/);
assert.match(contacts, /alreadyExists: true/);

assert.match(outreach, /code: "manual_prospect_existing_company_mismatch"/);
assert.match(outreach, /code: "manual_prospect_existing_link_owner"/);
assert.match(outreach, /linkedExisting: true/);

console.log("Complete client entry validation passed");
