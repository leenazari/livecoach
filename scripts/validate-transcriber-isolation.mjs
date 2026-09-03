import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [baseMigration, sharedMigration, access, start, stop, backfill, sessionEnd, stage, identity] =
  await Promise.all([
    read("supabase/migrations/20260821144742_per_user_transcriber_isolation.sql"),
    read("supabase/migrations/20260903165256_shared_meeting_capture_fanout.sql"),
    read("app/api/meet/access/route.ts"),
    read("app/api/meet/start/route.ts"),
    read("app/api/meet/stop/route.ts"),
    read("app/api/meet/backfill/route.ts"),
    read("app/api/interview/session-end/route.ts"),
    read("components/MeetStage.tsx"),
    read("lib/transcriber.ts"),
  ]);

assert.match(baseMigration, /create table if not exists public\.meet_stream_tokens/i);
assert.match(baseMigration, /alter table public\.meet_stream_tokens enable row level security/i);
assert.match(baseMigration, /unique \(owner_id, session_id\)/i);
assert.match(baseMigration, /meet_bots_webhook_token_hash_uidx/i);
assert.match(baseMigration, /explicit record owner is required/i);
assert.match(sharedMigration, /alter table public\.meet_capture_subscribers enable row level security/i);
assert.match(sharedMigration, /revoke all on public\.meet_capture_subscribers from public, anon, authenticated/i);
assert.match(sharedMigration, /using \([\s\S]*?owner_id = \(select auth\.uid\(\)\)[\s\S]*?wm\.status = 'active'/i);

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
assert.match(start, /owner_id: accountScope\.userId/);
assert.match(start, /workspace_id: accountScope\.workspaceId/);
assert.match(start, /leaveUntrackedBot/);
assert.doesNotMatch(start, /Lee's Transcriber/);

assert.match(stop, /\.from\("meet_capture_subscribers"\)[\s\S]*?\.eq\("owner_id", accountScope\.userId\)/);
assert.match(stop, /Never call Recall with a browser-supplied bot id directly/);
assert.match(backfill, /\.from\("meet_capture_subscribers"\)[\s\S]*?\.eq\("owner_id", accountScope\.userId\)/);
assert.match(sessionEnd, /\.from\("meet_stream_tokens"\)/);
assert.match(stage, /livecoach-token\.\$\{access\.token\}/);
assert.match(stage, /coachHintsRef/);
assert.match(stage, /teamHintsRef/);
assert.match(stage, /WS_RECONNECT_WARNING_GRACE_MS = 8000/);
assert.match(stage, /wsRef\.current === ws/);
assert.match(stage, /Receiving speech is definitive proof/);
assert.match(stage, /showReconnectWarning/);
assert.match(stage, /This does not mean the\s+notetaker has stopped recording/);
assert.doesNotMatch(stage, /New speech is not being captured this second/);
assert.doesNotMatch(stage, /COACH_HINTS = \["lee nazari"/i);
assert.match(identity, /deriveTranscriberName/);

console.log("Per-user transcriber isolation validation passed");
