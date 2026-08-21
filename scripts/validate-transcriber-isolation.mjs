import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [migration, access, start, stop, backfill, sessionEnd, stage, identity] =
  await Promise.all([
    read("supabase/migrations/20260821142441_per_user_transcriber_isolation.sql"),
    read("app/api/meet/access/route.ts"),
    read("app/api/meet/start/route.ts"),
    read("app/api/meet/stop/route.ts"),
    read("app/api/meet/backfill/route.ts"),
    read("app/api/interview/session-end/route.ts"),
    read("components/MeetStage.tsx"),
    read("lib/transcriber.ts"),
  ]);

assert.match(migration, /create table if not exists public\.meet_stream_tokens/i);
assert.match(migration, /alter table public\.meet_stream_tokens enable row level security/i);
assert.match(
  migration,
  /revoke all on public\.meet_stream_tokens from public, anon, authenticated/i
);
assert.match(migration, /unique \(owner_id, session_id\)/i);
assert.match(migration, /meet_bots_webhook_token_hash_uidx/i);
assert.match(migration, /webhook_token_expires_at/i);
assert.match(migration, /active_member_count = 1/i);
assert.match(migration, /explicit record owner is required/i);

assert.match(access, /randomBytes\(32\)/);
assert.match(access, /createHash\("sha256"\)/);
assert.match(access, /token_hash: tokenHash/);
assert.doesNotMatch(access, /token_hash: rawToken/);
assert.match(access, /workspace_id: scope\.workspaceId/);
assert.match(access, /owner_id: scope\.userId/);

assert.match(start, /getTranscriberIdentity\(accountScope\.userId\)/);
assert.match(start, /randomBytes\(32\)/);
assert.match(start, /webhook_token_hash: webhookTokenHash/);
assert.match(start, /realtimeEndpoint\.searchParams\.set\("token", webhookToken\)/);
assert.doesNotMatch(start, /webhook_token_hash: webhookToken[,}]/);
assert.match(start, /bot_name: identity\.botName/);
assert.match(start, /owner_id: accountScope\.userId/);
assert.match(start, /workspace_id: accountScope\.workspaceId/);
assert.match(start, /leaveUntrackedBot/);
assert.doesNotMatch(start, /Lee's Transcriber/);

assert.match(stop, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(stop, /Never call Recall with a browser-supplied bot id directly/);
assert.match(backfill, /\.eq\("owner_id", accountScope\.userId\)/);
assert.match(sessionEnd, /\.from\("meet_stream_tokens"\)/);
assert.match(stage, /livecoach-token\.\$\{access\.token\}/);
assert.match(stage, /coachHintsRef/);
assert.doesNotMatch(stage, /COACH_HINTS = \["lee nazari"/i);
assert.match(identity, /deriveTranscriberName/);

console.log("Per-user transcriber isolation validation passed");
