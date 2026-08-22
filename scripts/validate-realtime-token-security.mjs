import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260822105657_realtime_token_security.sql"
);
const middleware = read("middleware.ts");
const security = read("lib/realtime-token-security.ts");
const livekit = read("lib/livekit.ts");
const inviteRoute = read("app/api/livekit/invite/route.ts");
const tokenRoute = read("app/api/livekit/token/route.ts");
const practiceRoute = read("app/api/livekit/practice-token/route.ts");
const deepgramRoute = read("app/api/deepgram-token/route.ts");
const callStage = read("components/CallStage.tsx");
const candidateBot = read("app/candidate-bot/[room]/page.tsx");
const joinPage = read("app/join/[room]/page.tsx");
const callPage = read("app/call/page.tsx");
const sessionEnd = read("app/api/interview/session-end/route.ts");
const teamRoute = read("app/api/crm/team/route.ts");

assert.match(migration, /create table if not exists public\.livekit_join_invites/i);
assert.match(migration, /create table if not exists public\.livekit_rooms/i);
assert.match(migration, /room_id text primary key/i);
assert.match(migration, /alter table public\.livekit_rooms enable row level security/i);
assert.match(
  migration,
  /revoke all on public\.livekit_rooms from public, anon, authenticated/i
);
assert.match(
  migration,
  /room_id text not null references public\.livekit_rooms\(room_id\)/i
);
assert.match(migration, /alter table public\.livekit_join_invites enable row level security/i);
assert.match(
  migration,
  /revoke all on public\.livekit_join_invites from public, anon, authenticated/i
);
assert.match(migration, /invite_token_hash text not null unique/i);
assert.match(migration, /candidate_session_hash text unique/i);
assert.match(migration, /unique \(owner_id, room_id\)/i);
assert.match(migration, /create table if not exists public\.realtime_token_rate_limits/i);
assert.match(migration, /create or replace function public\.consume_realtime_token_rate_limit/i);
assert.match(migration, /security invoker/i);
assert.match(
  migration,
  /revoke execute on function public\.consume_realtime_token_rate_limit[\s\S]*?from public, anon, authenticated/i
);

assert.match(middleware, /isCandidateCapableApi/);
assert.match(middleware, /path === "\/api\/livekit\/token"/);
assert.match(middleware, /path === "\/api\/deepgram-token"/);
assert.match(middleware, /path === "\/api\/livekit\/invite"/);
assert.match(middleware, /path === "\/api\/livekit\/practice-token"/);

assert.match(security, /randomBytes\(32\)/);
assert.match(security, /createHash\("sha256"\)/);
assert.match(security, /invite_token_hash: tokenHash/);
assert.doesNotMatch(security, /invite_token_hash: rawToken/);
assert.match(security, /candidate_session_hash: hashRealtimeSecret\(rawSession\)/);
assert.match(security, /\.is\("redeemed_at", null\)/);
assert.match(security, /sameSite: "strict"/);
assert.match(security, /httpOnly: true/);
assert.match(security, /access_audit_events/);
assert.match(security, /consume_realtime_token_rate_limit/);
assert.match(security, /export async function enforceAnonymousRealtimeAttempt/);
assert.match(security, /export async function claimLiveKitRoom/);
assert.match(security, /This call room belongs to a different account/);
assert.match(security, /insertError\.code === "23505"/);

assert.match(inviteRoute, /requireRequestScope\(\)/);
assert.match(inviteRoute, /url\.hash = `invite=/);
assert.doesNotMatch(inviteRoute, /searchParams\.set\("invite"/);

assert.match(tokenRoute, /authorizeCandidateRoom/);
assert.match(tokenRoute, /getRequestScope\(\)/);
assert.match(tokenRoute, /body\?\.candidateSession === true/);
assert.match(tokenRoute, /role: "candidate"/);
assert.match(tokenRoute, /role: "interviewer"/);
assert.doesNotMatch(tokenRoute, /body\?\.role/);
assert.doesNotMatch(tokenRoute, /role === "candidate"/);
assert.match(tokenRoute, /enforceRealtimeRateLimit/);
assert.match(tokenRoute, /enforceAnonymousRealtimeAttempt/);
assert.match(tokenRoute, /claimLiveKitRoom\(scope, room\)/);

assert.match(practiceRoute, /requireRequestScope\(\)/);
assert.match(practiceRoute, /claimLiveKitRoom\(scope, room\)/);
assert.match(practiceRoute, /role: "candidate"/);
assert.match(candidateBot, /\/api\/livekit\/practice-token/);
assert.doesNotMatch(candidateBot, /body: JSON\.stringify\(\{[\s\S]{0,120}role:/);

assert.match(deepgramRoute, /getRequestScope\(\)/);
assert.match(deepgramRoute, /getCandidateSession\(req\)/);
assert.match(deepgramRoute, /enforceRealtimeRateLimit/);
assert.match(deepgramRoute, /enforceAnonymousRealtimeAttempt/);
assert.doesNotMatch(deepgramRoute, /detail: e\?\.message/);

assert.match(livekit, /name: opts\.displayName/);
assert.match(livekit, /canUpdateOwnMetadata: false/);
assert.match(callStage, /onCandidateSessionReady/);
assert.match(callStage, /inviteToken/);
assert.match(callStage, /candidateSession: true/);
assert.match(callStage, /parseRole\(participant\)/);
assert.doesNotMatch(callStage, /handleLine\(msg\.role/);
assert.doesNotMatch(callStage, /JSON\.stringify\(\{ type: "transcript", role/);

assert.match(joinPage, /window\.location\.hash/);
assert.match(joinPage, /window\.sessionStorage/);
assert.match(callPage, /\/api\/livekit\/invite/);
assert.match(callPage, /secure one-time join link/i);
assert.match(callPage, /crypto\.randomUUID\(\)/);
assert.match(sessionEnd, /\.from\("livekit_join_invites"\)/);
assert.match(sessionEnd, /\.from\("livekit_rooms"\)/);
assert.match(teamRoute, /\.from\("livekit_join_invites"\)/);
assert.match(teamRoute, /\.from\("livekit_rooms"\)/);

console.log("Realtime provider token security validation passed");
