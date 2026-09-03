import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  calendarHasExternalGuest,
  emailMayInfluenceCompanyIntent,
  pickPrimaryAttendee,
} from "../lib/calendar-subject.ts";
import {
  deriveNewClientFromAttendees,
  inferLink,
  shouldRepairStaleCalendarCompanyLink,
} from "../lib/attendee-linking.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

const internalDomains = [
  "ai13.com",
  "interviewa.com",
  "schoolofcoding.co.uk",
];

const accessInvite = [
  { email: "evelina.zhekova@accessfs.co.uk", responseStatus: "accepted" },
  { email: "georgi.georgiev@accessfs.co.uk", responseStatus: "accepted" },
  { email: "kamm@interviewa.com", responseStatus: "accepted" },
  { email: "lee@ai13.com", self: true, organizer: true },
];

assert.equal(
  pickPrimaryAttendee(accessInvite, {
    title: "George demo + Interviewa",
    internalDomains,
  })?.email,
  "georgi.georgiev@accessfs.co.uk",
  "one small first-name spelling variation must select Georgi, never the internal supporter"
);
assert.equal(
  calendarHasExternalGuest(accessInvite, internalDomains),
  true,
  "the outside Access Financial Services guests must keep internal supporting attendees out of subject selection"
);

const staleCalendarConfig = {
  internalDomains: new Set(internalDomains),
  internalCompanyId: "00000000-0000-4000-8000-000000000099",
  contactEmailToCompany: new Map(),
  companyByDomain: new Map(),
};
assert.equal(
  shouldRepairStaleCalendarCompanyLink(
    {
      id: "00000000-0000-4000-8000-000000000099",
      name: "Interviewa",
      domain: "interviewa.com",
      profile: { internal: true },
    },
    accessInvite,
    staleCalendarConfig
  ),
  true,
  "an internal placeholder must be repaired when all outside guests share one work domain"
);
assert.equal(
  shouldRepairStaleCalendarCompanyLink(
    {
      id: "00000000-0000-4000-8000-000000000088",
      name: "Curated client",
      domain: "client.example.org",
      profile: {},
    },
    accessInvite,
    staleCalendarConfig
  ),
  false,
  "a normal client link must never be overwritten automatically"
);
const ninderInvite = [
  { email: "kamm@interviewa.com", responseStatus: "accepted" },
  { email: "lee@ai13.com", self: true, organizer: true },
  { email: "ninderjohal@nachural.co.uk", responseStatus: "needsAction" },
  { email: "yas@interviewa.com", responseStatus: "accepted" },
];

const referralCompanyId = "00000000-0000-4000-8000-000000000001";
const logicDialogCompanyId = "00000000-0000-4000-8000-000000000002";
const referralConfig = {
  internalDomains: new Set(internalDomains),
  internalCompanyId: null,
  contactEmailToCompany: new Map([
    ["steve@team.co.uk", referralCompanyId],
  ]),
  companyByDomain: new Map([["team.co.uk", referralCompanyId]]),
};
const introducedPaulInvite = [
  { email: "paul@logicdialog.ai", responseStatus: "accepted" },
  { email: "lee@ai13.com", self: true, organizer: true },
  { email: "steve@team.co.uk", responseStatus: "needsAction" },
];

assert.deepEqual(
  inferLink(introducedPaulInvite, referralConfig, {
    title: "Interviewa + paul@logicdialog.ai",
  }),
  { companyId: null, isInternal: false },
  "a saved referrer must not become the client when the title names a new lead"
);

assert.deepEqual(
  deriveNewClientFromAttendees(introducedPaulInvite, referralConfig, {
    title: "Interviewa + paul@logicdialog.ai",
  }),
  {
    domain: "logicdialog.ai",
    name: "Logicdialog",
    website: "https://logicdialog.ai",
    email: "paul@logicdialog.ai",
  },
  "the named lead's work domain must create the separate client"
);

assert.deepEqual(
  inferLink(introducedPaulInvite, {
    ...referralConfig,
    companyByDomain: new Map([
      ["team.co.uk", referralCompanyId],
      ["logicdialog.ai", logicDialogCompanyId],
    ]),
  }, {
    title: "Interviewa + paul@logicdialog.ai",
  }),
  { companyId: logicDialogCompanyId, isInternal: false },
  "the named lead's own company must beat the saved referrer"
);

assert.deepEqual(
  inferLink(introducedPaulInvite, referralConfig),
  { companyId: null, isInternal: false },
  "multiple external domains without a named subject must fail closed"
);

assert.equal(
  pickPrimaryAttendee(
    [
      { email: "paul@ripponcapital.co.uk" },
      { email: "paul@logicdialog.ai" },
      { email: "lee@ai13.com", self: true },
    ],
    {
      title: "Interviewa + paul@logicdialog.ai",
      internalDomains,
    }
  )?.email,
  "paul@logicdialog.ai",
  "an exact email in the title must distinguish two guests with the same name"
);

const internalNamedInvite = [
  { email: "kamm@interviewa.com" },
  { email: "buyer@customer.com" },
  { email: "lee@ai13.com", self: true },
];
const internalNamedConfig = {
  ...referralConfig,
  internalCompanyId: "00000000-0000-4000-8000-000000000003",
  contactEmailToCompany: new Map([
    ["kamm@interviewa.com", "00000000-0000-4000-8000-000000000003"],
  ]),
};
assert.deepEqual(
  inferLink(internalNamedInvite, internalNamedConfig, {
    title: "Kamm client introduction",
  }),
  { companyId: null, isInternal: false },
  "a named internal supporter must not replace the outside client"
);
assert.equal(
  deriveNewClientFromAttendees(internalNamedInvite, internalNamedConfig, {
    title: "Kamm client introduction",
  })?.domain,
  "customer.com",
  "the single outside work domain must still create the client"
);

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
  cronRoute,
  researchCache,
  attendeeResolver,
  callSubject,
  prepIntent,
  prepSubject,
  workstreams,
  calendarSync,
] =
  await Promise.all([
    read("app/api/crm/email-pull/route.ts"),
    read("app/api/crm/upcoming/[id]/route.ts"),
    read("app/call/page.tsx"),
    read("app/api/cron/precall-email-context/route.ts"),
    read("lib/research-cache.ts"),
    read("lib/attendees.ts"),
    read("lib/call-subject.ts"),
    read("app/api/crm/companies/[id]/prep-intent/route.ts"),
    read("app/api/interview/prep-subject/route.ts"),
    read("lib/workstreams.ts"),
    read("app/api/crm/calendar-sync/route.ts"),
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
assert.match(cronRoute, /upcomingId: sourceCall\.id/);
assert.doesNotMatch(callPage, /function pickGuest/);
assert.doesNotMatch(researchCache, /export function pickGuest/);
assert.match(attendeeResolver, /"ai13\.com"/);
assert.match(attendeeResolver, /"interviewa\.com"/);
assert.match(attendeeResolver, /"schoolofcoding\.co\.uk"/);
assert.match(callSubject, /eligibleAttendees/);
assert.match(callSubject, /emailMayInfluenceCompanyIntent/);
assert.match(callSubject, /calendarHasExternalGuest/);
assert.match(callSubject, /hasExternalGuest/);
assert.match(prepIntent, /basedOnLeadEmail/);
assert.match(prepIntent, /email_context_counterparty_email/);
assert.match(prepSubject, /emailContextMatchesLead/);
assert.match(prepSubject, /emailAllowedForCompany/);
assert.match(prepSubject, /companyId = call\.company_id/);
assert.match(workstreams, /leadOnlyAttendees/);
assert.match(workstreams, /hasLeadDecision/);
assert.match(calendarSync, /shouldRepairStaleCalendarCompanyLink/);
assert.match(calendarSync, /companyId !== currentCompanyId/);
assert.match(calendarSync, /\.\.\.privateRecordFields\(scope\)/);
assert.match(calendarSync, /company_id: repairedCompany\.get[\s\S]{0,300}intent: null[\s\S]{0,200}prep: null[\s\S]{0,120}prepped: false/);

console.log("calendar primary attendee validation passed");
