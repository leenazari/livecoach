import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getOutreachImportHeaderError,
  normaliseOutreachImportRows,
  parseCsvRows,
} from "../lib/outreach-import.ts";

const normalise = (rows, outreach = [], contacts = []) =>
  normaliseOutreachImportRows(rows, new Set(outreach), new Set(contacts));
const csv = '\uFEFFFirst_Name,Last_Name,Company_Name,Email_Id,Contact_Number,Job_Title,LinkedIn_URL,Company_LinkedIn_URL\r\nPat,Example,"Example, Ltd",PAT@EXAMPLE.INVALID,01234567890,Director,https://www.linkedin.com/in/example,https://www.linkedin.com/company/example/\r\n';
const rows = parseCsvRows(csv);
assert.equal(rows.length, 1);
assert.equal(getOutreachImportHeaderError(rows), null);
const [lead] = normalise(rows);
assert.equal(lead.decision, "ready");
assert.equal(lead.email, "pat@example.invalid");
assert.equal(lead.phone, "01234567890");
assert.equal(lead.companyName, "Example, Ltd");
assert.equal(lead.firstName, "Pat");
assert.equal(lead.lastName, "Example");
assert.equal(lead.jobTitle, "Director");
assert.equal(lead.personLinkedinUrl, rows[0].LinkedIn_URL);
assert.equal(lead.companyLinkedinUrl, rows[0].Company_LinkedIn_URL);
assert.equal(lead.importStatus, "imported");

for (const header of ["Email", "Email Address", "Work_Email", "Email_Id", " EMAIL-ID ", "EmailId", "E-mail", "E-mail address"]) {
  const input = [{ [header]: "pat@example.invalid", Company: "Example" }];
  assert.equal(getOutreachImportHeaderError(input), null, header);
  assert.equal(normalise(input)[0].decision, "ready", header);
}
for (const header of ["Phone", "Phone Number", "Mobile", "Contact_Number", " CONTACT-NUMBER "]) {
  assert.equal(normalise([{ Email: "pat@example.invalid", Company: "Example", [header]: "01234567890" }])[0].phone, "01234567890", header);
}

// A recognised but empty email column is a row error, not a header error.
const blankEmail = [{ Email_Id: "", Company: "Example" }];
assert.equal(getOutreachImportHeaderError(blankEmail), null);
assert.equal(normalise(blankEmail)[0].decision, "invalid");
assert.equal(normalise([{ Email_Id: "not an address", Company: "Example" }])[0].decision, "invalid");
assert.equal(normalise([{ Email_Id: "pat@example.invalid" }])[0].decision, "review");
assert.match(getOutreachImportHeaderError([{ Mailbox: "pat@example.invalid", Company: "Example" }]), /No email column/);
assert.match(getOutreachImportHeaderError([null, [], "not a row"]), /No email column/);
assert.equal(getOutreachImportHeaderError([]), null);
assert.equal(parseCsvRows("Email,Company").length, 0);
assert.equal(parseCsvRows('Email,Company\n"unfinished').length, 0);

// Preserve duplicate protection across uploads, contacts and this file.
assert.equal(normalise(rows, ["pat@example.invalid"])[0].decision, "duplicate");
assert.equal(normalise(rows, [], ["pat@example.invalid"])[0].decision, "duplicate");
assert.deepEqual(normalise([...rows, ...rows]).map((row) => row.decision), ["ready", "duplicate"]);
assert.equal(normalise([{ ...rows[0], Status: "do not contact" }])[0].importStatus, "suppressed");
assert.equal(normalise([{ ...rows[0], Status: "emailed" }])[0].importStatus, "contacted");

// Header validation happens before any database scans or staged writes.
const stage = readFileSync(new URL("../app/api/crm/imports/outreach/stage/route.ts", import.meta.url), "utf8");
assert.ok(stage.indexOf("getOutreachImportHeaderError(body.rows)") < stage.indexOf("const [outreachEmails, contactEmails]"));
assert.match(stage, /NextResponse\.json\(\{ error: headerError \}, \{ status: 400 \}\)/);
const ui = readFileSync(new URL("../components/crm/StagedOutreachImports.tsx", import.meta.url), "utf8");
assert.doesNotMatch(ui, /A header row is required/);
assert.match(ui, /disabled=\{\!\!busy \|\| \!parsedRows\.length \|\| \!\!headerError\}/);
assert.match(ui, /Choose a CSV file or paste a list with column headings/);

console.log("Outreach import headers passed. Email_Id, Contact_Number, CSV parsing, clear errors and duplicate protection verified.");
