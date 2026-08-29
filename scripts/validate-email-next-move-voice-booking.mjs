import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const [
  migration,
  separateVoiceMigration,
  assistant,
  voice,
  voiceNote,
  voicePolicy,
  voiceConfig,
  patchRoute,
  voiceRoute,
  rehearseRoute,
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
  read("supabase/migrations/20260829083628_separate_email_assistant_reply_voice.sql"),
  read("lib/email-assistant.ts"),
  read("lib/email-assistant-voice.ts"),
  read("lib/email-assistant-voice-note.ts"),
  read("lib/email-assistant-voice-policy.ts"),
  read("lib/email-assistant-voice-config.ts"),
  read("app/api/crm/email-assistant/drafts/[id]/route.ts"),
  read("app/api/crm/email-assistant/drafts/[id]/voice/route.ts"),
  read("app/api/crm/email-assistant/drafts/[id]/rehearse/route.ts"),
  read("lib/mail.ts"),
  read("lib/sales-profile.ts"),
  read("lib/sales-profile-types.ts"),
  read("app/api/crm/sales-profile/route.ts"),
  read("app/settings/sales-profile/page.tsx"),
  read("app/crm/board/page.tsx"),
  read("components/crm/EmailAssistantVoiceNoteEditor.tsx"),
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

assert.match(separateVoiceMigration, /add column if not exists email_assistant_voice_id text/);
assert.match(separateVoiceMigration, /add column if not exists email_assistant_voice_name text/);
assert.match(separateVoiceMigration, /status in \('draft', 'blocked'\)/);
assert.match(separateVoiceMigration, /voice_provider_voice_id = null/);
assert.doesNotMatch(separateVoiceMigration, /outreach_voice_id/);

assert.match(profileTypes, /bookingUrl: string/);
assert.match(profileTypes, /emailAssistantVoiceId: string/);
assert.match(profileTypes, /emailAssistantVoiceName: string/);
assert.match(profile, /booking_url,email_assistant_voice_id,email_assistant_voice_name,outreach_voice_id/);
assert.match(profile, /Your booking link must be a full https:\/\/ address/);
assert.match(profileRoute, /booking_url: input\.bookingUrl \|\| null/);
assert.match(profileRoute, /email_assistant_voice_id:/);
assert.match(profileRoute, /input\.emailAssistantVoiceId !== previous\.emailAssistantVoiceId/);
assert.match(profileRoute, /Email Assistant voice invalidation failed/);
assert.doesNotMatch(profileRoute, /body\.(?:userId|workspaceId)/);
assert.match(profilePage, /Your personal booking link/);
assert.match(profilePage, /Each salesperson saves their own link/);
assert.match(profilePage, /nobody else&apos;s calendar is substituted/);
assert.match(profilePage, /Email Assistant reply voice/);
assert.match(profilePage, /Outreach campaign voice/);
assert.match(profilePage, /Choose only the Email Assistant reply voice/);
assert.match(profilePage, /Use for Email Assistant/);
assert.match(profilePage, /Use for Outreach/);
assert.match(profilePage, /each saves and uses its own voice/);

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
assert.match(assistant, /resolveEmailAssistantVoiceConfig\(scope\)/);
assert.doesNotMatch(assistant, /resolveOutreachVoiceConfig/);
assert.doesNotMatch(assistant, /outreach-voice/);
assert.match(assistant, /invalidateEmailAssistantVoiceAudio/);
assert.match(assistant, /emailAssistantVoiceMatchesCurrentConfig/);
assert.match(assistant, /voiceIntent: EmailAssistantVoiceIntent/);
assert.match(assistant, /voiceIncluded: Boolean\(voiceNote\)/);

assert.match(patchRoute, /requireRequestScope/);
assert.match(patchRoute, /approveVoiceScript: body\?\.approve_voice_script/);
assert.match(voiceRoute, /requireRequestScope/);
assert.match(voiceRoute, /generateEmailAssistantVoiceNote/);
assert.match(rehearseRoute, /requireRequestScope/);
assert.match(rehearseRoute, /voice_intent/);
assert.match(rehearseRoute, /rehearseEmailAssistantDraft/);
assert.match(voice, /loadOwnedEmailAssistantDraft/);
assert.match(voice, /draft\.voice_script_approved_by !== scope\.userId/);
assert.match(voice, /Approve this exact voice script before creating the paid audio/);
assert.match(voice, /assertEmailAssistantVoiceWithinBudget/);
assert.match(voice, /generateElevenLabsEmailAssistantAudio/);
assert.match(voice, /emailAssistantVoiceStoragePath/);
assert.match(voice, /EMAIL_ASSISTANT_VOICE_BUCKET/);
assert.match(voice, /\.eq\("owner_id", scope\.userId\)/);
assert.match(voice, /configuredEmailAssistantVoiceCostGbp/);
assert.match(voice, /resolveEmailAssistantVoiceConfig\(scope\)/);
assert.doesNotMatch(voice, /resolveOutreachVoiceConfig/);
assert.doesNotMatch(voice, /outreach-voice/);

assert.match(voicePolicy, /EMAIL_ASSISTANT_VOICE_TARGET_WORDS = 100/);
assert.match(voicePolicy, /emailAssistantVoiceReadyForDisplayedScript/);
assert.doesNotMatch(voicePolicy, /OUTREACH_VOICE/);
assert.match(voiceNote, /emailAssistantVoiceMatchesCurrentConfig/);
assert.match(voiceNote, /draft\.voice_script_hash ===/);
assert.match(voiceNote, /draft\.voice_model_id === config\.modelId/);
assert.match(voiceNote, /draft\.voice_provider_voice_id === config\.voiceId/);
assert.doesNotMatch(voiceNote, /outreach-voice/);

assert.match(voiceConfig, /email_assistant_voice_id,email_assistant_voice_name/);
assert.match(voiceConfig, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(voiceConfig, /\.eq\("user_id", scope\.userId\)/);
assert.match(voiceConfig, /Brain and Outreach voices are never substituted/);
assert.match(voiceConfig, /ELEVENLABS_EMAIL_ASSISTANT_MODEL_ID/);
assert.doesNotMatch(voiceConfig, /outreach_voice_id/);
assert.doesNotMatch(voiceConfig, /ELEVENLABS_VOICE_ID/);
assert.doesNotMatch(voiceConfig, /ELEVENLABS_OUTREACH_MODEL_ID/);

assert.match(board, /approveNextMoveVoiceScript/);
assert.match(board, /generateNextMoveVoice/);
assert.match(board, /EmailAssistantVoiceNoteEditor/);
assert.match(board, /emailAssistantVoiceReadyForDisplayedScript/);
assert.match(board, /voice_intent: voiceIntent/);
assert.match(board, /Approve email without voice to/);
assert.match(board, /Send test to me/);
assert.match(editor, /1 · Approve reply script/);
assert.match(editor, /Choose reply voice/);
assert.doesNotMatch(editor, /outreach-voice/);
assert.match(mail, /voiceNote\?:/);
assert.match(mail, /I’ve added a short personal voice message for you/);

assert.match(listener, /robots: \{ index: false/);
assert.match(listener, /\.eq\("voice_public_token", params\.token\)/);
assert.match(listener, /Book a meeting with/);
assert.match(listener, /AI-assisted voice message/);
assert.doesNotMatch(listener, /outreach_sender_name/);
assert.match(audio, /createSignedUrl/);
assert.match(audio, /EMAIL_ASSISTANT_VOICE_BUCKET/);
assert.doesNotMatch(audio, /outreach-voice-note/);
assert.match(audio, /Cache-Control", "private, no-store/);

assert.doesNotMatch(overnight, /generateEmailAssistantVoiceNote/);
assert.doesNotMatch(overnight, /ElevenLabs/);

console.log("Separate salesperson Email Assistant voice and booking checks passed");
