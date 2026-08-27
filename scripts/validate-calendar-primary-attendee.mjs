import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  emailMayInfluenceCompanyIntent,
  pickPrimaryAttendee,
} from "../lib/calendar-subject.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const internalDomains = [
  "ai13.com",
  "interviewa.com",
  "schoolofcoding.co.uk",
];
const ninderInvite = [
  { email: "kamm@interviewa.com", responseStatus: "accepted" },
  { email: "lee@ai13.com", self: true, organizer: true },
  { email: "ninderjohal@nachural.co.uk", responseStatus: "needsAction" },
  { email: "yas@interviewa.com", responseStatus: "accepted" },
];

assert.deepEqual(
  pickPrimaryAttendee(ninderInvite, {
    title: "Ninder + interviewa",
    internalDomains,
  }),
  {
    name: "Ninderjohal",
    email: "ninderjohal@nachural.co.uk",
    matchedBy: "meeting_title",
  },
  "the named meeting subject must beat the first accepted work attendee"
);

assert.equal(
  pickPrimaryAttendee(ninderInvite, {
    title: "Onsite meeting",
    internalDomains,
  })?.email,
  "ninderjohal@nachural.co.uk",
  "the only external attendee must beat internal supporting attendees"
);

assert.equal(
  pickPrimaryAttendee(
    [
      { email: "host@interviewa.com", self: true },
      { email: "assistant@agency.co.uk", responseStatus: "accepted" },
      { email: "buyer@customer.com", responseStatus: "needsAction" },
    ],
    {
      title: "Customer discovery",
      contactEmails: ["buyer@customer.com"],
      internalDomains,
    }
  )?.email,
  "buyer@customer.com",
  "an exact linked contact must beat calendar response status"
);

assert.equal(
  pickPrimaryAttendee(
    [
      { email: "host@interviewa.com", self: true },
      { email: "adviser@partner.com" },
      { email: "buyer@customer.com" },
    ],
    {
      title: "Quarterly review",
      companyDomain: "customer.com",
      internalDomains,
    }
  )?.email,
  "buyer@customer.com",
  "a unique linked company domain must win"
);

assert.equal(
  pickPrimaryAttendee(
    [
      { email: "host@interviewa.com", self: true },
      { email: "one@alpha.com" },
      { email: "two@beta.com" },
    ],
    { title: "Partnership discussion", internalDomains }
  ),
  null,
  "two external guests without a lead signal must remain ambiguous"
);

assert.equal(
  pickPrimaryAttendee(
    [
      { email: "lee@ai13.com", self: true },
      { email: "kamm@interviewa.com" },
      { email: "jaykishan@ai13.com" },
    ],
    { title: "Jaykishan product brainstorming", internalDomains }
  )?.email,
  "jaykishan@ai13.com",
  "a named internal meeting subject must beat another internal invitee"
);

for (const protectedEmail of [
  "kamm@interviewa.com",
  "jay@ai13.com",
  "tim@schoolofcoding.co.uk",
]) {
  assert.equal(
    emailMayInfluenceCompanyIntent(protectedEmail, {
      companyDomain: "nachural.co.uk",
      protectedDomains: internalDomains,
    }),
    false,
    `${protectedEmail} must not influence an unrelated external client`
  );
}

assert.equal(
  emailMayInfluenceCompanyIntent("ninderjohal@nachural.co.uk", {
    companyDomain: "nachural.co.uk",
    protectedDomains: internalDomains,
  }),
  true,
  "the validated external lead may influence their own client"
);

assert.equal(
  emailMayInfluenceCompanyIntent("tim@schoolofcoding.co.uk", {
    companyDomain: "schoolofcoding.co.uk",
    protectedDomains: internalDomains,
  }),
  true,
  "a direct School of Coding meeting may use its own lead email"
);

assert.equal(
  emailMayInfluenceCompanyIntent("kamm@interviewa.com", {
    companyDomain: "ai13.com",
    companyInternal: true,
    protectedDomains: internalDomains,
  }),
  true,
  "a direct internal meeting may use an internal attendee"
);

const [
  emailPull,
  upcomingRoute,
  callPage,
  prepPage,
  cronRoute,
  researchCache,
  attendeeResolver,
  callSubject,
  prepIntent,
  prepSubject,
  workstreams,
] =
  await Promise.all([
    read("app/api/crm/email-pull/route.ts"),
    read("app/api/crm/upcoming/[id]/route.ts"),
    read("app/call/page.tsx"),
    read("app/crm/prep/page.tsx"),
    read("app/api/cron/precall-email-context/route.ts"),
    read("lib/research-cache.ts"),
    read("lib/attendees.ts"),
    read("lib/call-subject.ts"),
    read("app/api/crm/companies/[id]/prep-intent/route.ts"),
    read("app/api/interview/prep-subject/route.ts"),
    read("lib/workstreams.ts"),
  ]);

assert.match(emailPull, /loadPrimaryAttendeeForUpcoming\(upcomingId\)/);
assert.match(emailPull, /resolved\.call\.company_id/);
assert.match(emailPull, /email !== resolved\.primaryAttendee\.email/);
assert.match(emailPull, /emailMayInfluenceCompanyIntent/);
assert.match(emailPull, /email_context_counterparty_email/);
assert.match(upcomingRoute, /primaryAttendee/);
assert.match(upcomingRoute, /config\.companyByDomain\.get/);
assert.doesNotMatch(upcomingRoute, /const names = data\.attendees/);
assert.match(callPage, /\(call as any\)\.primaryAttendee/);
assert.match(callPage, /upcomingId: upcoming/);
assert.match(callPage, /hasServerLeadDecision/);
assert.match(prepPage, /upcomingId: upcomingId \|\| undefined/);
assert.match(cronRoute, /upcomingId: sourceCall\.id/);
assert.doesNotMatch(callPage, /function pickGuest/);
assert.doesNotMatch(researchCache, /export function pickGuest/);
assert.match(attendeeResolver, /"ai13\.com"/);
assert.match(attendeeResolver, /"interviewa\.com"/);
assert.match(attendeeResolver, /"schoolofcoding\.co\.uk"/);
assert.match(callSubject, /eligibleAttendees/);
assert.match(callSubject, /emailMayInfluenceCompanyIntent/);
assert.match(prepIntent, /basedOnLeadEmail/);
assert.match(prepIntent, /email_context_counterparty_email/);
assert.match(prepSubject, /emailContextMatchesLead/);
assert.match(prepSubject, /emailAllowedForCompany/);
assert.match(workstreams, /leadOnlyAttendees/);
assert.match(workstreams, /hasLeadDecision/);

console.log("calendar primary attendee validation passed");
