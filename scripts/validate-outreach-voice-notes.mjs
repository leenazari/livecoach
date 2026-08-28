import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260828221810_outreach_personal_voice_notes.sql"
);
const prepare = read("app/api/crm/outreach/[id]/prepare/route.ts");
const generate = read(
  "app/api/crm/outreach/messages/[id]/voice/route.ts"
);
const patchRoute = read("app/api/crm/outreach/messages/[id]/route.ts");
const queue = read("app/api/crm/outreach/queue/route.ts");
const sender = read("lib/outreach-send-queue.ts");
const mail = read("lib/mail.ts");
const player = read("app/listen/[token]/page.tsx");
const audio = read("app/api/listen/[token]/audio/route.ts");
const played = read("app/api/listen/[token]/played/route.ts");
const editor = read("components/crm/OutreachVoiceNoteEditor.tsx");
const outreachPage = read("app/crm/outreach/page.tsx");
const today = read("components/crm/OutreachTodayLane.tsx");
const profile = read("lib/sales-profile.ts");

assert.match(migration, /add column if not exists outreach_voice_id text/);
assert.match(migration, /add column if not exists voice_script text/);
assert.match(migration, /voice_public_token uuid not null default gen_random_uuid/);
assert.match(migration, /outreach_messages_voice_public_token_unique/);
assert.match(migration, /'outreach-voice-notes'[\s\S]*?false/);
assert.doesNotMatch(migration, /create policy[\s\S]*?storage\.objects/i);

assert.match(prepare, /required: \["research", "strategy", "email", "voiceNote"\]/);
assert.match(prepare, /105 to 135 words/);
assert.match(prepare, /voice_status: "script_ready"/);
assert.match(prepare, /preserveReadyAudio/);

assert.match(generate, /resolveOutreachIdentity\(\)/);
assert.match(generate, /\.eq\("workspace_id", sender\.workspaceId\)/);
assert.match(generate, /\.eq\("sender_user_id", sender\.userId\)/);
assert.match(generate, /outreachVoiceScriptHash/);
assert.match(generate, /voice_status === "ready"/);
assert.match(generate, /reused: true/);
assert.match(generate, /OUTREACH_VOICE_BUCKET/);
assert.match(generate, /configuredVoiceNoteCostGbp/);
assert.match(generate, /\.eq\("voice_script", script\)/);

assert.match(patchRoute, /voiceChanged/);
assert.match(patchRoute, /voice_audio_path = null/);
assert.match(patchRoute, /Generate and preview the personal voice note before approving/);
assert.match(queue, /voice_public_token/);

assert.match(sender, /outreachVoicePublicUrl/);
assert.match(sender, /message\.voice_status === "ready"/);
assert.match(sender, /The personal voice note is not ready/);
assert.match(mail, /I recorded a short personal message for you/);
assert.match(mail, /voiceNote\?:/);

assert.match(player, /robots: \{ index: false/);
assert.match(player, /PublicVoiceNotePlayer/);
assert.match(audio, /createSignedUrl/);
assert.match(audio, /voice_public_token/);
assert.match(played, /kind: "voice_played"/);

assert.match(editor, /Create voice preview/);
assert.match(editor, /Aim for 105 to 135 words/);
assert.match(outreachPage, /generateVoiceNote/);
assert.match(outreachPage, /OutreachVoiceNoteEditor/);
assert.match(today, /generateVoiceNote/);
assert.match(today, /OutreachVoiceNoteEditor/);

assert.match(profile, /outreach_voice_id/);
assert.match(profile, /\.eq\("user_id", scope\.userId\)/);

console.log("Owner-scoped outreach voice note checks passed");
