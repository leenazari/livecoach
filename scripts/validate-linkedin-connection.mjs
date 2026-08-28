import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const connector = read("lib/linkedin.ts");
const oauthStateSource = read("lib/linkedin-oauth-state.ts");
const start = read("app/api/auth/linkedin/start/route.ts");
const callback = read("app/api/auth/linkedin/callback/route.ts");
const status = read("app/api/auth/linkedin/status/route.ts");
const disconnect = read("app/api/auth/linkedin/disconnect/route.ts");
const settings = read("app/settings/page.tsx");
const middleware = read("middleware.ts");
const supabase = read("lib/supabase.ts");
const migration = read(
  "supabase/migrations/20260827220117_linkedin_connector_foundation.sql"
);

assert.match(connector, /^import "server-only";/);
assert.match(connector, /Cross-account LinkedIn access is not permitted/);
assert.match(connector, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(connector, /\.eq\("owner_id", exactOwner\)/);
assert.match(connector, /LINKEDIN_IDENTITY_SCOPES = \["openid", "profile", "email"\]/);
assert.match(connector, /LINKEDIN_SOCIAL_SCOPE = "w_member_social"/);

assert.match(start, /createLinkedInOAuthState/);
assert.match(start, /httpOnly: true/);
assert.match(start, /secure: true/);
assert.match(start, /sameSite: "lax"/);
assert.match(start, /includeSocial = request\.nextUrl\.searchParams\.get\("social"\) === "1"/);
assert.doesNotMatch(start, /linkedin_oauth_owner/);

assert.match(callback, /verifyLinkedInOAuthState/);
assert.match(callback, /cookieState && state !== cookieState/);
assert.match(callback, /\.eq\("workspace_id", oauthState\.workspaceId\)/);
assert.match(callback, /\.eq\("member_id", memberId\)/);
assert.match(callback, /\.neq\("owner_id", oauthState\.userId\)/);
assert.match(callback, /linkedin_connector_connected/);
assert.match(callback, /\["active", "onboarding"\]/);

assert.match(oauthStateSource, /createCipheriv/);
assert.match(oauthStateSource, /createDecipheriv/);
assert.match(oauthStateSource, /aes-256-gcm/);
assert.match(oauthStateSource, /LINKEDIN_OAUTH_STATE_TTL_MS = 10 \* 60 \* 1000/);

assert.doesNotMatch(status, /accessToken|refreshToken|access_token|refresh_token/);
assert.match(status, /Cache-Control": "private, no-store"/);
assert.match(disconnect, /disconnectLinkedInConnection/);
assert.match(disconnect, /linkedin_connector_disconnected/);

assert.match(
  middleware,
  /path\.startsWith\("\/api\/auth\/linkedin"\)[\s\S]*path !== "\/api\/auth\/linkedin\/callback"/
);
assert.match(supabase, /"linkedin_oauth"/);
assert.match(migration, /alter table public\.linkedin_oauth enable row level security/);
assert.match(migration, /revoke all on public\.linkedin_oauth from public, anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on public\.linkedin_oauth to service_role/);
assert.doesNotMatch(migration, /create policy/i);

assert.match(settings, /belongs only to this LiveCoach account/);
assert.match(settings, /approved API connection does not read LinkedIn messages/);
assert.match(settings, /separate local inbox capture below is optional and user-triggered/);
assert.match(settings, /publishes anything automatically/);
assert.match(settings, /href="\/api\/auth\/linkedin\/start\?social=1"/);
assert.match(settings, /href="\/api\/auth\/linkedin\/start"/);

const { createLinkedInOAuthState, verifyLinkedInOAuthState } = await import(
  "../lib/linkedin-oauth-state.ts"
);
const secret = "test-linkedin-client-secret";
const now = 1_787_900_000_000;
const testUserId = "11111111-1111-4111-8111-111111111111";
const testWorkspaceId = "22222222-2222-4222-8222-222222222222";
const signedState = createLinkedInOAuthState(
  {
    userId: testUserId,
    workspaceId: testWorkspaceId,
    returnOrigin: "https://www.livecoachcrm.com/settings",
    includeSocial: false,
    issuedAt: now,
  },
  secret
);
assert.deepEqual(verifyLinkedInOAuthState(signedState, { now, secret }), {
  userId: testUserId,
  workspaceId: testWorkspaceId,
  returnOrigin: "https://www.livecoachcrm.com",
  includeSocial: false,
  issuedAt: now,
});
assert.equal(
  verifyLinkedInOAuthState(`${signedState}tampered`, { now, secret }),
  null
);
assert.equal(
  verifyLinkedInOAuthState(signedState, {
    now: now + 10 * 60 * 1000 + 1,
    secret,
  }),
  null
);

console.log("LinkedIn per-user connection checks passed");
