import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const start = read("app/api/auth/google/start/route.ts");
const callback = read("app/api/auth/google/callback/route.ts");
const connector = read("lib/google.ts");
const middleware = read("middleware.ts");

assert.match(start, /requireRequestScope/);
assert.match(start, /createGoogleOAuthState/);
assert.match(start, /connectorReturnOrigin\(request\.nextUrl\.origin\)/);
assert.doesNotMatch(start, /Math\.random/);

assert.match(callback, /verifyGoogleOAuthState/);
assert.match(callback, /cookieState && state !== cookieState/);
assert.match(callback, /\["active", "onboarding"\]/);
assert.match(callback, /saveGoogleConnectionForOwner/);
assert.match(callback, /oauthState\.workspaceId/);
assert.match(callback, /oauthState\.userId/);
assert.match(callback, /Google OAuth callback failed/);
assert.doesNotMatch(callback, /getRequestScope/);
assert.match(callback, /membership\.status === "active" && email/);
assert.match(callback, /outreach_sender_name/);
assert.match(callback, /outreach_sender_email: normalizedEmail/);
assert.match(callback, /\.eq\("user_id", oauthState\.userId\)/);
assert.match(callback, /\.is\("outreach_sender_email", null\)/);
assert.match(callback, /verified Gmail send-as alias/);

assert.match(connector, /export async function saveGoogleConnectionForOwner/);
assert.match(connector, /GOOGLE_DRIVE_FILE_SCOPE/);
assert.match(connector, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
assert.match(connector, /\.eq\("workspace_id", owner\.workspaceId\)/);
assert.match(connector, /\.eq\("owner_id", owner\.userId\)/);
assert.match(
  middleware,
  /path\.startsWith\("\/api\/auth\/google"\)[\s\S]*path !== "\/api\/auth\/google\/callback"/
);

const { createGoogleOAuthState, verifyGoogleOAuthState } = await import(
  "../lib/google-oauth-state.ts"
);
const secret = "test-google-client-secret";
const now = 1_787_900_000_000;
const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const signedState = createGoogleOAuthState(
  {
    userId,
    workspaceId,
    returnOrigin: "https://www.livecoachcrm.com/settings",
    onboarding: false,
    issuedAt: now,
  },
  secret
);

assert.deepEqual(verifyGoogleOAuthState(signedState, { now, secret }), {
  userId,
  workspaceId,
  returnOrigin: "https://www.livecoachcrm.com",
  onboarding: false,
  issuedAt: now,
});
assert.equal(
  verifyGoogleOAuthState(`${signedState}tampered`, { now, secret }),
  null
);
assert.equal(
  verifyGoogleOAuthState(signedState, {
    now: now + 10 * 60 * 1000 + 1,
    secret,
  }),
  null
);

console.log("Google cross-domain OAuth callback checks passed");
