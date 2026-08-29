import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const [
  migration,
  assistant,
  voice,
  patchRoute,
  voiceRoute,
  mail,
  profile,
  profileTypes,
  profileRoute,
  profilePage,
  board,
  editor,
  listener,
  audio,
  overnight,
] = await Promise.all([
  read("supabase/migrations/20260829004508_email_next_move_voice_booking.sql"),
  read("lib/email-assistant.ts"),
  read("lib/email-assistant-voice.ts"),
  read("app/api/crm/email-assistant/drafts/[id]/route.ts"),
  read("app/api/crm/email-assistant/drafts/[id]/voice/route.ts"),
  read("lib/mail.ts"),
  read("lib/sales-profile.ts"),
  read("lib/sales-profile-types.ts"),
  read("app/api/crm/sales-profile/route.ts"),
  read("app/settings/sales-profile/page.tsx"),
  read("app/crm/board/page.tsx"),
  read("components/crm/OutreachVoiceNoteEditor.tsx"),
  read("app/listen/next-move/[token]/page.tsx"),
  read("app/api/listen/next-move/[token]/audio/route.ts"),
  read("app/api/cron/email-next-moves/route.ts"),
]);

assert.match(migration, /salesperson_profiles[\s\S]*?booking_url text/);
assert.match(migration, /count\(distinct btrim\(booking_url\)\) = 1/);
assert.match(migration, /profile\.user_id = links\.user_id/);
assert.match(migration, /meeting_cta_recommended boolean not null default false/);
assert.match(migration, /voice_public_token uuid not null default gen_random_uuid/);
assert.match(migration, /voice_script_approved_by = owner_id/);
assert.match(migration, /email_assistant_one_voice_generation_per_owner_idx/);
assert.match(migration, /validate_email_assistant_booking_owner/);
assert.match(migration, /profile\.workspace_id = new\.workspace_id/);
assert.match(migration, /profile\.user_id = new\.owner_id/);
assert.match(migration, /profile\.booking_url = new\.booking_url/);
assert.doesNotMatch(migration, /create policy[\s\S]*?storage\.objects/i);

assert.match(profileTypes, /bookingUrl: string/);
assert.match(profile, /booking_url,outreach_voice_id/);
assert.match(profile, /Your booking link must be a full https:\/\/ address/);
assert.match(profileRoute, /booking_url: input\.bookingUrl \|\| null/);
assert.doesNotMatch(profileRoute, /body\.(?:userId|workspaceId)/);
assert.match(profilePage, /Your personal booking link/);
assert.match(profilePage, /Each salesperson saves their own link/);
assert.match(profilePage, /nobody else&apos;s calendar is substituted/);

assert.match(assistant, /"voiceScript":"\.\.\."/);
assert.match(assistant, /Audio is not generated automatically/);
assert.match(assistant, /getSalesProfile\(scope\)/);
assert.match(assistant, /emailAssistantMeetingCtaRecommended/);
assert.match(assistant, /booking_url: bookingUrl \|\| null/);
assert.match(assistant, /voice_status: voiceScript \? "script_ready" : "none"/);
assert.match(assistant, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(assistant, /\.eq\("user_id", scope\.userId\)/);
assert.match(assistant, /Keep your personal booking link exactly once/);
assert.match(assistant, /emailAssistantVoicePublicUrl/);
assert.match(assistant, /createConnectedMailDraft/);

assert.match(patchRoute, /requireRequestScope/);
assert.match(patchRoute, /approveVoiceScript: body\?\.approve_voice_script/);
assert.match(voiceRoute, /requireRequestScope/);
assert.match(voiceRoute, /generateEmailAssistantVoiceNote/);
assert.match(voice, /loadOwnedEmailAssistantDraft/);
assert.match(voice, /draft\.voice_script_approved_by !== scope\.userId/);
assert.match(voice, /Approve this exact voice script before creating the paid audio/);
assert.match(voice, /assertOutreachVoiceWithinBudget/);
assert.match(voice, /generateElevenLabsOutreachAudio/);
assert.match(voice, /emailAssistantVoiceStoragePath/);
assert.match(voice, /OUTREACH_VOICE_BUCKET/);
assert.match(voice, /\.eq\("owner_id", scope\.userId\)/);
assert.match(voice, /configuredVoiceNoteCostGbp/);

assert.match(board, /approveNextMoveVoiceScript/);
assert.match(board, /generateNextMoveVoice/);
assert.match(board, /kind="next-move"/);
assert.match(board, /You can approve the email without audio/);
assert.match(editor, /1 · Approve script/);
assert.match(editor, /kind === "next-move"/);
assert.match(mail, /voiceNote\?:/);
assert.match(mail, /I recorded a short personal voice note for you/);

assert.match(listener, /robots: \{ index: false/);
assert.match(listener, /\.eq\("voice_public_token", params\.token\)/);
assert.match(listener, /Book a meeting with/);
assert.match(audio, /createSignedUrl/);
assert.match(audio, /OUTREACH_VOICE_BUCKET/);
assert.match(audio, /Cache-Control", "private, no-store/);

assert.doesNotMatch(overnight, /generateEmailAssistantVoiceNote/);
assert.doesNotMatch(overnight, /ElevenLabs/);

console.log("Owner-scoped next-move voice and booking checks passed");
