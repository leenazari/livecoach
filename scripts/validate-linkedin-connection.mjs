import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const connector = read("lib/linkedin.ts");
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

assert.match(start, /randomBytes\(32\)/);
assert.match(start, /httpOnly: true/);
assert.match(start, /secure: true/);
assert.match(start, /sameSite: "lax"/);
assert.match(start, /includeSocial = request\.nextUrl\.searchParams\.get\("social"\) === "1"/);
assert.match(start, /response\.cookies\.set\("linkedin_oauth_owner", scope\.userId/);

assert.match(callback, /state !== cookieState/);
assert.match(callback, /cookieOwner !== scope\.userId/);
assert.match(callback, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(callback, /\.eq\("member_id", memberId\)/);
assert.match(callback, /\.neq\("owner_id", scope\.userId\)/);
assert.match(callback, /linkedin_connector_connected/);

assert.doesNotMatch(status, /accessToken|refreshToken|access_token|refresh_token/);
assert.match(status, /Cache-Control": "private, no-store"/);
assert.match(disconnect, /disconnectLinkedInConnection/);
assert.match(disconnect, /linkedin_connector_disconnected/);

assert.match(middleware, /path\.startsWith\("\/api\/auth\/linkedin"\)/);
assert.match(supabase, /"linkedin_oauth"/);
assert.match(migration, /alter table public\.linkedin_oauth enable row level security/);
assert.match(migration, /revoke all on public\.linkedin_oauth from public, anon, authenticated/);
assert.match(migration, /grant select, insert, update, delete on public\.linkedin_oauth to service_role/);
assert.doesNotMatch(migration, /create policy/i);

assert.match(settings, /belongs only to this LiveCoach account/);
assert.match(settings, /Messages and connection requests remain manual/);
assert.match(settings, /never publishes anything automatically/);
assert.match(settings, /href="\/api\/auth\/linkedin\/start\?social=1"/);
assert.match(settings, /href="\/api\/auth\/linkedin\/start"/);

console.log("LinkedIn per-user connection checks passed");
