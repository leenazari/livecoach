import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const helper = read("lib/outreach-booking-link.ts");
const profile = read("lib/sales-profile.ts");
const prepare = read("app/api/crm/outreach/[id]/prepare/route.ts");
const replyRoute = read("app/api/crm/outreach/replies/[id]/draft/route.ts");
const reply = read("lib/outreach-positive-reply.ts");
const readiness = read("app/api/crm/outreach/readiness/route.ts");
const campaignRoute = read("app/api/crm/outreach/campaigns/[id]/route.ts");
const assistantRoute = read("app/api/crm/assistant/route.ts");
const outreachPage = read("app/crm/outreach/page.tsx");
const profilePage = read("app/settings/sales-profile/page.tsx");

// The only source is the exact salesperson profile selected by both user and
// workspace. There is deliberately no campaign or global fallback.
assert.match(helper, /getSalesProfile\(scope\)/);
assert.match(helper, /profile\.bookingUrl/);
assert.doesNotMatch(helper, /booking_url|getAppConfigValue|outreach_campaigns/);
assert.match(profile, /getOptionalSalesProfile\([\s\S]*?scopeOverride\?: Scope/);
assert.match(profile, /getSalesProfile\(scopeOverride\)/);

// Cold sequence preparation may use that personal link according to campaign
// timing, but never reads the legacy campaign booking URL.
assert.match(prepare, /getOptionalSalesProfile\(\{[\s\S]*?userId: sender\.userId,[\s\S]*?workspaceId: sender\.workspaceId/);
assert.match(prepare, /personalProfile\.bookingUrl/);
assert.match(prepare, /shouldIncludePersonalOutreachBookingLink/);
assert.match(prepare, /personalBookingUrl/);
assert.doesNotMatch(prepare, /campaign\.booking_url/);
assert.match(prepare, /booking_link_included: includeBooking/);

// Positive replies fail closed unless the signed-in salesperson has a link.
assert.match(replyRoute, /requireRequestScope\(\)/);
assert.match(replyRoute, /preparePositiveReplyForApproval\(scope, params\.id\)/);
assert.match(reply, /getPersonalOutreachBookingLink\(scope\)/);
assert.match(reply, /\.eq\("owner_id", scope\.userId\)/);
assert.match(reply, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(reply, /Add your personal booking link in My Sales Setup first/);
assert.match(reply, /campaign\.booking_cta_mode === "never"/);
assert.doesNotMatch(reply, /getAppConfigValue|outreach_default_booking_url|campaign\?\.booking_url|campaign\.booking_url/);

// Readiness and the UI point to personal setup. Campaigns can select the
// personal-link action, but never store the salesperson's actual URL.
assert.match(readiness, /getPersonalOutreachBookingLink/);
assert.match(readiness, /label: "Your booking link"/);
assert.match(readiness, /href: "\/settings\/sales-profile"/);
assert.doesNotMatch(readiness, /campaign\?\.booking_url|campaign\.booking_url/);
assert.doesNotMatch(campaignRoute, /patch\.booking_url/);
assert.match(campaignRoute, /Campaign booking links are legacy data/);
assert.match(campaignRoute, /booking_cta_mode/);
assert.doesNotMatch(assistantRoute, /patch\.booking_url|"bookingUrl":"https:\/\//);
assert.match(assistantRoute, /Personal booking links are never stored in campaigns/);
assert.match(outreachPage, /Personal calendar handoff/);
assert.match(outreachPage, /Open My Sales Setup/);
assert.match(outreachPage, /booking_cta_mode/);
assert.doesNotMatch(outreachPage, /activeCampaign\.booking_url|booking_url: e\.target\.value/);
assert.match(profilePage, /Outreach and Email Assistant use this exact salesperson-specific link/);
assert.match(profilePage, /A teammate, campaign or global link can never replace it/);

console.log("Salesperson-specific Outreach booking link checks passed");
