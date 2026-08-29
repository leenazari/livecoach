import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const helperSource = read("lib/account-readiness.ts");
const api = read("app/api/crm/account-readiness/route.ts");
const page = read("app/settings/readiness/page.tsx");
const nav = read("components/crm/NavMenu.tsx");
const teamApi = read("app/api/crm/team/route.ts");
const rehearsal = read(
  "app/api/crm/outreach/messages/[id]/rehearse/route.ts"
);
const emailAssistantRehearsal = read(
  "app/api/crm/email-assistant/drafts/[id]/rehearse/route.ts"
);

assert.match(helperSource, /type AccountReadinessFacts/);
assert.match(helperSource, /connectedProviderCount > 1/);
assert.match(helperSource, /privacyTestConfirmedAt/);
assert.match(helperSource, /Each user receives a separate call bot/);
assert.match(helperSource, /"linkedin"/);
assert.match(helperSource, /Connect your own LinkedIn identity/);

assert.match(api, /requireRequestScope\(\)/);
assert.match(api, /if \(scope\.role !== "owner"\)/);
assert.match(api, /membershipQuery\.eq\("user_id", scope\.userId\)/);
assert.match(api, /scope\.role === "owner"\s*\? \{ team \}/);
assert.match(api, /Cache-Control": "private, no-store"/);
assert.match(api, /aiUsed: false/);
assert.match(api, /capabilities/);
assert.match(api, /replyVoiceReady/);
assert.match(api, /providerDraftReady/);
assert.match(api, /rehearsalReady/);
assert.match(api, /email_assistant_rehearsal_accepted/);
assert.match(api, /\.from\("linkedin_oauth"\)/);
assert.doesNotMatch(api, /linkedin_oauth[\s\S]{0,180}access_token/);
assert.match(api, /\.select\("owner_id,created_at"\)/);
assert.doesNotMatch(api, /\.select\([^)]*body_text/);
assert.doesNotMatch(api, /\.select\([^)]*email_context/);
assert.doesNotMatch(api, /\.select\([^)]*access_token/);
assert.doesNotMatch(api, /NextResponse\.json\([\s\S]{0,500}refresh_token/);

assert.match(page, /Account readiness/);
assert.match(page, /uses no AI tokens/);
assert.match(page, /Lee only/);
assert.match(page, /never exposes another/);
assert.match(page, /crmFetch<ReadinessData>\(READINESS_URL\)/);
assert.match(page, /ownerReview/);
assert.match(page, /Ask this person to complete it/);
assert.doesNotMatch(page, /interview_sessions|outreach_messages|google_oauth/);

assert.match(nav, /href: "\/settings\/readiness"/);
assert.match(rehearsal, /account_readiness_test_email_completed/);
assert.match(rehearsal, /target_id: sender\.userId/);
assert.match(emailAssistantRehearsal, /rehearseEmailAssistantDraft/);
assert.match(emailAssistantRehearsal, /voice_intent/);
assert.match(teamApi, /account_readiness_test_email_completed/);
assert.match(teamApi, /Math\.max\(sentResult\.count \|\| 0, rehearsalResult\.count \|\| 0\)/);
assert.doesNotMatch(
  rehearsal.match(/action: "account_readiness_test_email_completed"[\s\S]*?\}\);/)?.[0] || "",
  /body_text/
);

const { buildAccountReadiness } = await import(
  pathToFileURL(path.join(root, "lib/account-readiness.ts")).href
);

const base = {
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Test Seller",
  email: "seller@example.com",
  role: "sales",
  membershipStatus: "active",
  salesProfileComplete: true,
  connectedProviderCount: 1,
  provider: "google",
  providerEmail: "seller@example.com",
  mailRead: true,
  mailSend: true,
  senderName: "Test Seller",
  senderEmail: "seller@example.com",
  senderVerified: true,
  calendarConnected: true,
  lastCalendarSyncAt: "2026-08-27T08:00:00.000Z",
  linkedinConnected: true,
  linkedinSocialAccess: false,
  transcriberName: "Test Seller's LiveCoach Notetaker",
  transcriberPlatformReady: true,
  assignedProspects: 2,
  sharedPoolProspects: 10,
  sharedClients: 1,
  privacyBoundaryActive: true,
  privacyTestConfirmedAt: "2026-08-26T12:00:00.000Z",
  testEmailCompletedAt: "2026-08-26T12:30:00.000Z",
  transcribedCalls: 1,
};

const ready = buildAccountReadiness(base, new Date("2026-08-27T12:00:00.000Z"));
assert.equal(ready.isReady, true);
assert.equal(ready.readyCount, 10);

const linkedinMissing = buildAccountReadiness({
  ...base,
  linkedinConnected: false,
});
assert.equal(
  linkedinMissing.checks.find((check) => check.id === "linkedin")?.state,
  "action"
);
assert.equal(
  linkedinMissing.checks.find((check) => check.id === "linkedin")?.href,
  "/settings#linkedin"
);

const duplicateMailbox = buildAccountReadiness({
  ...base,
  connectedProviderCount: 2,
});
assert.equal(
  duplicateMailbox.checks.find((check) => check.id === "email")?.state,
  "action"
);

const unconfirmedPrivacy = buildAccountReadiness({
  ...base,
  privacyTestConfirmedAt: null,
});
const privacy = unconfirmedPrivacy.checks.find(
  (check) => check.id === "privacy"
);
assert.equal(privacy?.state, "action");
assert.equal(privacy?.href, undefined);

const owner = buildAccountReadiness({
  ...base,
  role: "owner",
  privacyTestConfirmedAt: null,
});
assert.equal(
  owner.checks.find((check) => check.id === "privacy")?.state,
  "ready"
);

const secondUser = buildAccountReadiness({
  ...base,
  userId: "00000000-0000-4000-8000-000000000002",
  displayName: "Second Seller",
  email: "second@example.com",
  providerEmail: "second@example.com",
  senderName: "Second Seller",
  senderEmail: "second@example.com",
  assignedProspects: 0,
  sharedPoolProspects: 3,
  sharedClients: 0,
});
assert.match(
  ready.checks.find((check) => check.id === "leads")?.detail || "",
  /^2 assigned, 10 available/
);
assert.match(
  secondUser.checks.find((check) => check.id === "leads")?.detail || "",
  /^0 assigned, 3 available/
);
assert.doesNotMatch(JSON.stringify(secondUser), /seller@example\.com/);

console.log("Account Readiness validation passed");
