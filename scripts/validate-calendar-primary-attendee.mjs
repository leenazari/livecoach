import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { pickPrimaryAttendee } from "../lib/calendar-subject.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const internalDomains = ["ai13.com", "interviewa.com"];
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

const [
  emailPull,
  upcomingRoute,
  callPage,
  prepPage,
  cronRoute,
  researchCache,
  attendeeResolver,
] =
  await Promise.all([
    read("app/api/crm/email-pull/route.ts"),
    read("app/api/crm/upcoming/[id]/route.ts"),
    read("app/call/page.tsx"),
    read("app/crm/prep/page.tsx"),
    read("app/api/cron/precall-email-context/route.ts"),
    read("lib/research-cache.ts"),
    read("lib/attendees.ts"),
  ]);

assert.match(emailPull, /loadPrimaryAttendeeForUpcoming\(upcomingId\)/);
assert.match(emailPull, /resolved\.call\.company_id/);
assert.match(emailPull, /email !== resolved\.primaryAttendee\.email/);
assert.match(upcomingRoute, /primaryAttendee/);
assert.match(upcomingRoute, /config\.companyByDomain\.get/);
assert.doesNotMatch(upcomingRoute, /const names = data\.attendees/);
assert.match(callPage, /\(call as any\)\?\.primaryAttendee/);
assert.match(callPage, /upcomingId: upcoming/);
assert.match(prepPage, /upcomingId: upcomingId \|\| undefined/);
assert.match(cronRoute, /upcomingId: sourceCall\.id/);
assert.doesNotMatch(callPage, /function pickGuest/);
assert.doesNotMatch(researchCache, /export function pickGuest/);
assert.match(attendeeResolver, /"ai13\.com"/);
assert.match(attendeeResolver, /"interviewa\.com"/);

console.log("calendar primary attendee validation passed");
