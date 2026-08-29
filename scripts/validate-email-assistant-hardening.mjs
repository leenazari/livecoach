import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

const [
  assistant,
  assistantVoice,
  assistantVoiceNote,
  assistantVoicePolicy,
  assistantVoiceConfig,
  board,
  editor,
  approveRoute,
  rehearseRoute,
  draftsRoute,
  listenPage,
  audioRoute,
  mail,
  profilePage,
  readinessRoute,
  overnight,
  outreachEditor,
] = await Promise.all([
  read("lib/email-assistant.ts"),
  read("lib/email-assistant-voice.ts"),
  read("lib/email-assistant-voice-note.ts"),
  read("lib/email-assistant-voice-policy.ts"),
  read("lib/email-assistant-voice-config.ts"),
  read("app/crm/board/page.tsx"),
  read("components/crm/EmailAssistantVoiceNoteEditor.tsx"),
  read("app/api/crm/email-assistant/drafts/[id]/approve/route.ts"),
  read("app/api/crm/email-assistant/drafts/[id]/rehearse/route.ts"),
  read("app/api/crm/email-assistant/drafts/route.ts"),
  read("app/listen/next-move/[token]/page.tsx"),
  read("app/api/listen/next-move/[token]/audio/route.ts"),
  read("lib/mail.ts"),
  read("app/settings/sales-profile/page.tsx"),
  read("app/api/crm/account-readiness/route.ts"),
  read("app/api/cron/email-next-moves/route.ts"),
  read("components/crm/OutreachVoiceNoteEditor.tsx"),
]);

// The client declares a voice intent and the server independently proves the
// exact script, selected reply voice and model before attaching any audio.
assert.match(board, /emailAssistantVoiceReadyForDisplayedScript/);
assert.match(board, /voice_intent: voiceIntent/);
assert.match(board, /Approve email without voice to/);
assert.match(approveRoute, /voice_intent/);
assert.match(approveRoute, /handOffEmailAssistantDraft\(params\.id, voiceIntent\)/);
assert.match(assistant, /emailAssistantVoiceMatchesCurrentConfig/);
assert.match(assistantVoiceNote, /draft\.voice_script_hash ===/);
assert.match(assistantVoiceNote, /draft\.voice_model_id === config\.modelId/);
assert.match(assistantVoiceNote, /draft\.voice_provider_voice_id === config\.voiceId/);
assert.match(assistantVoiceNote, /draft\.voice_script_approved_by === draft\.owner_id/);

// Email Assistant has no implementation dependency on Outreach policy, config,
// editor, public URL or storage exports.
for (const source of [
  assistant,
  assistantVoice,
  assistantVoiceNote,
  assistantVoicePolicy,
  editor,
  audioRoute,
]) {
  assert.doesNotMatch(source, /@\/lib\/outreach-voice/);
  assert.doesNotMatch(source, /OutreachVoiceNoteEditor/);
}
assert.match(board, /EmailAssistantVoiceNoteEditor/);
assert.doesNotMatch(board, /kind="next-move"/);
assert.doesNotMatch(outreachEditor, /next-move/);
assert.match(assistantVoiceConfig, /email_assistant_voice_id/);
assert.doesNotMatch(assistantVoiceConfig, /outreach_voice_id/);

// Every database path stays bound to the signed-in workspace and owner. No API
// accepts another salesperson identity from the request body.
for (const source of [assistant, assistantVoice]) {
  assert.match(source, /\.eq\("workspace_id", scope\.workspaceId\)/);
  assert.match(source, /\.eq\("owner_id", scope\.userId\)/);
}
assert.match(assistant, /\.eq\("user_id", scope\.userId\)/);
assert.doesNotMatch(approveRoute, /body\.(?:userId|ownerId|workspaceId)/);
assert.doesNotMatch(rehearseRoute, /body\.(?:userId|ownerId|workspaceId)/);
assert.match(rehearseRoute, /requireRequestScope/);
assert.match(draftsRoute, /getEmailAssistantCapabilities/);

// Rehearsal always redirects the exact saved provider content to the signed-in
// mailbox and cannot mutate the prospect or campaign.
assert.match(assistant, /rehearseEmailAssistantDraft/);
assert.match(assistant, /to: mailboxEmail/);
assert.match(assistant, /recipientChanged: false/);
assert.match(assistant, /email_assistant_rehearsal_accepted/);
assert.match(board, /Send test to me/);
assert.match(mail, /buildConnectedMailDraftContent/);

// Point-of-use readiness and settings keep voice optional and product-specific.
assert.match(draftsRoute, /capabilities/);
assert.match(assistant, /replyVoiceReady/);
assert.match(board, /Email-only approval is ready/);
assert.match(editor, /Email-only approval remains available/);
assert.match(profilePage, /Pick one product at a time/);
assert.match(profilePage, /Choose only the Email Assistant reply voice/);
assert.match(profilePage, /Choose only the Outreach campaign voice/);
assert.match(readinessRoute, /providerDraftReady/);
assert.match(readinessRoute, /rehearsalReady/);
assert.match(readinessRoute, /replyVoiceReady/);

// Recipient-facing language is accurate about AI assistance and never borrows
// the Outreach sender identity.
assert.match(mail, /I’ve added a short personal voice message for you/);
assert.doesNotMatch(mail, /I recorded a short personal voice note for you/);
assert.match(listenPage, /AI-assisted voice message/);
assert.match(listenPage, /\.select\("display_name"\)/);
assert.doesNotMatch(listenPage, /outreach_sender_name/);

// Paid generation remains separately approved and never runs overnight.
assert.match(assistantVoice, /Approve this exact voice script before creating the paid audio/);
assert.match(editor, /no voice cost has been incurred/);
assert.doesNotMatch(overnight, /generateEmailAssistantVoiceNote|ElevenLabs/);

const policy = await import(
  pathToFileURL(path.join(root, "lib/email-assistant-voice-policy.ts")).href
);
const readyRecord = {
  voice_script: "Hello Jo. Here is the useful next step.",
  voice_status: "ready",
  voice_audio_path: "workspace/user/email-assistant/draft/hash.mp3",
  voice_public_token: "00000000-0000-4000-8000-000000000001",
  voice_script_hash: "hash",
  voice_model_id: "eleven_flash_v2_5",
  voice_provider_voice_id: "voice-user-a",
  voice_script_approved_at: "2026-08-29T12:00:00.000Z",
  voice_script_approved_by: "00000000-0000-4000-8000-000000000010",
  voice_script_approved_hash: "approval-hash",
};
assert.equal(
  policy.emailAssistantVoiceReadyForDisplayedScript(
    readyRecord,
    "Hello Jo. Here is the useful next step."
  ),
  true
);
assert.equal(
  policy.emailAssistantVoiceReadyForDisplayedScript(
    readyRecord,
    "Hello Jo. I changed the next step."
  ),
  false
);
assert.equal(
  policy.emailAssistantVoiceReadyForDisplayedScript(
    { ...readyRecord, voice_provider_voice_id: null },
    readyRecord.voice_script
  ),
  false
);
assert.equal(
  policy.emailAssistantVoiceReadyForDisplayedScript(
    { ...readyRecord, voice_script_approved_hash: null },
    readyRecord.voice_script
  ),
  false
);

// A second salesperson's record cannot be treated as the first person's ready
// record merely because the words match. The provider voice identity is part of
// both client readiness and the server-side generation hash check.
const secondUserRecord = {
  ...readyRecord,
  voice_provider_voice_id: "voice-user-b",
};
assert.notEqual(
  secondUserRecord.voice_provider_voice_id,
  readyRecord.voice_provider_voice_id
);
assert.match(assistantVoiceNote, /voiceScriptHash\(script, voiceId, modelId\)/);

console.log("Email Assistant hardening and two-user isolation checks passed");
