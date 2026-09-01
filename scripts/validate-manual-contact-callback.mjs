import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const assistant = read("app/api/crm/assistant/route.ts");
const emailPull = read("app/api/crm/email-pull/route.ts");
const contacts = read("app/api/crm/contacts/route.ts");
const tasks = read("app/api/crm/tasks/route.ts");
const company = read("app/api/crm/companies/[id]/route.ts");
const companyPage = read("app/crm/[id]/page.tsx");
const receipts = read("app/api/crm/assistant/receipts/route.ts");
const blockers = read("lib/crm-blocker.ts");

assert.match(assistant, /"client":"optional exact client name"/);
assert.match(assistant, /client:\s*typeof x\.client/);
assert.match(assistant, /if \(requestedClient && !company\) continue/);
assert.doesNotMatch(
  assistant.match(/if \(it\.type === "create_task"\)[\s\S]*?continue;\n\s*}/)?.[0] || "",
  /company\?\.id \|\| defaultCompanyId/,
  "A named to-do must never fall back to the open client page"
);
assert.match(tasks, /code: "task_client_mismatch"/);
assert.match(tasks, /loadAssignedClientAccess/);

assert.match(contacts, /code: "contact_company_not_assigned"/);
assert.match(contacts, /\.eq\("owner_id", scope\.userId\)/);
assert.match(contacts, /\.\.\.privateRecordFields\(scope\)/);
assert.match(company, /assigned salesperson see and add their[\s\S]*own contacts/);
assert.match(companyPage, /Your contacts/);
assert.match(companyPage, /Contacts you add to this assigned client are private/);

for (const code of [
  "email_contact_ambiguous",
  "email_client_not_assigned",
  "email_mailbox_read_failed",
  "email_thread_not_found",
  "email_mailbox_not_connected",
  "email_pull_not_confirmed",
]) {
  assert.match(emailPull, new RegExp(`code: ["']${code}["']`));
}
assert.match(emailPull, /sharedSalesTarget && companyId/);
assert.match(emailPull, /kind: "relationship"/);
assert.match(emailPull, /\.\.\.privateRecordFields\(scope\)/);
assert.match(emailPull, /\.eq\("owner_id", scope\.userId\)[\s\S]*?if \(!ownedWorkstream\) workstream = null/);
assert.doesNotMatch(emailPull, /The user is Lee/);
assert.doesNotMatch(
  emailPull,
  /No matching emails were found, or the connected mailbox is not readable yet/
);
assert.match(blockers, /path\.includes\("\/email-pull"\)/);

assert.match(receipts, /Date\.now\(\) - 60_000/);
assert.match(receipts, /duplicate: true/);

for (const staleCopy of [
  "This page was opened without inbox history",
  "No new mail app has been opened",
]) {
  assert.doesNotMatch(
    [assistant, emailPull, companyPage].join("\n"),
    new RegExp(staleCopy)
  );
}

console.log("Manual contact and callback validation passed");
