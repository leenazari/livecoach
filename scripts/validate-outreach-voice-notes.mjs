import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const migration = read(
  "supabase/migrations/20260828221810_outreach_personal_voice_notes.sql"
);
const costMigration = read(
  "supabase/migrations/20260828223725_outreach_voice_cost_guard.sql"
);
const benchmarkMigration = read(
  "supabase/migrations/20260828233644_outreach_voice_cost_benchmark.sql"
);
const approvalMigration = read(
  "supabase/migrations/20260828230805_outreach_voice_script_approval_gate.sql"
);
const policy = read("lib/outreach-voice-policy.ts");
const voice = read("lib/outreach-voice-note.ts");
const voiceDefault = read("lib/outreach-voice-default.ts");
const emailAssistantVoiceConfig = read("lib/email-assistant-voice-config.ts");
const prepare = read("app/api/crm/outreach/[id]/prepare/route.ts");
const generate = read(
  "app/api/crm/outreach/messages/[id]/voice/route.ts"
);
const createScript = read(
  "app/api/crm/outreach/messages/[id]/voice-script/route.ts"
);
const patchRoute = read("app/api/crm/outreach/messages/[id]/route.ts");
const queue = read("app/api/crm/outreach/queue/route.ts");
const sender = read("lib/outreach-send-queue.ts");
const mail = read("lib/mail.ts");
const player = read("app/listen/[token]/page.tsx");
const returnToInbox = read("components/ReturnToInboxButton.tsx");
const audio = read("app/api/listen/[token]/audio/route.ts");
const played = read("app/api/listen/[token]/played/route.ts");
const editor = read("components/crm/OutreachVoiceNoteEditor.tsx");
const outreachPage = read("app/crm/outreach/page.tsx");
const today = read("components/crm/OutreachTodayLane.tsx");
const profile = read("lib/sales-profile.ts");
const voiceLibrary = read("lib/salesperson-voice-library.ts");
const voiceLibraryRoute = read("app/api/crm/sales-profile/voices/route.ts");
const salesProfileRoute = read("app/api/crm/sales-profile/route.ts");
const salesProfilePage = read("app/settings/sales-profile/page.tsx");
const campaignRoute = read("app/api/crm/outreach/campaigns/[id]/route.ts");
const assistantRoute = read("app/api/crm/assistant/route.ts");

assert.match(migration, /add column if not exists outreach_voice_id text/);
assert.match(migration, /add column if not exists voice_script text/);
assert.match(migration, /voice_public_token uuid not null default gen_random_uuid/);
assert.match(migration, /outreach_messages_voice_public_token_unique/);
assert.match(migration, /'outreach-voice-notes'[\s\S]*?false/);
assert.doesNotMatch(migration, /create policy[\s\S]*?storage\.objects/i);
assert.match(costMigration, /voice_character_count between 1 and 800/);
assert.match(costMigration, /voice_estimated_cost_gbp between 0 and 0\.05/);
assert.match(benchmarkMigration, /voice_character_count between 1 and 1200/);
assert.match(
  benchmarkMigration,
  /voice_estimated_cost_gbp between 0 and 0\.075/
);
assert.match(approvalMigration, /voice_script_approved_at timestamptz/);
assert.match(approvalMigration, /voice_script_approved_by uuid/);
assert.match(approvalMigration, /voice_script_approved_hash text/);
assert.match(
  approvalMigration,
  /outreach_messages_one_voice_generation_per_sender_idx/
);
assert.match(approvalMigration, /where voice_status = 'generating'/);
assert.match(approvalMigration, /'voice_script_approved'/);
assert.match(policy, /OUTREACH_VOICE_TARGET_WORDS = 100/);
assert.match(policy, /OUTREACH_VOICE_PREFERRED_MIN_WORDS = 80/);
assert.match(policy, /OUTREACH_VOICE_PREFERRED_MAX_WORDS = 120/);
assert.match(policy, /OUTREACH_VOICE_HARD_MAX_WORDS = 150/);
assert.match(policy, /OUTREACH_VOICE_TARGET_COST_GBP = 0\.05/);
assert.match(policy, /OUTREACH_VOICE_HARD_MAX_COST_GBP = 0\.075/);
assert.match(policy, /OUTREACH_VOICE_HARD_MAX_CHARACTERS = 1200/);
assert.match(voice, /"eleven_flash_v2_5"/);
assert.match(voice, /\^eleven_\(flash\|turbo\)_/);
assert.match(voice, /assertOutreachVoiceWithinBudget/);
assert.match(voice, /outreachVoiceApprovalHash/);
assert.match(voice, /conservativeModelRateGbp/);
assert.doesNotMatch(voice, /slice\(0, OUTREACH_VOICE_MAX_WORDS\)/);
assert.doesNotMatch(voice, /clean\(value, 1800\)/);
assert.match(voice, /Never slice a spoken script/);
assert.doesNotMatch(voice, /process\.env\.ELEVENLABS_VOICE_ID/);
assert.doesNotMatch(voice, /usingOwnerDefault/);
assert.doesNotMatch(voice, /LiveCoach owner voice/);
assert.doesNotMatch(voice, /\.from\("workspace_members"\)/);
assert.match(voice, /selectEffectiveOutreachVoice\(profile\)/);
assert.match(voice, /voiceId: selectedVoice\.voiceId/);
assert.match(voice, /source: selectedVoice\.source/);
assert.match(voice, /OUTREACH_VOICE_DELIVERY_PROFILE = "warm_upbeat_steady_v4"/);
assert.match(voice, /stability: 0\.44/);
assert.match(voice, /similarity_boost: 0\.8/);
assert.match(voice, /style: 0\.36/);
assert.match(voice, /settings: OUTREACH_VOICE_SETTINGS/);
assert.match(voice, /`\$\{modelId\}:\$\{OUTREACH_VOICE_DELIVERY_PROFILE\}`/);
assert.match(voice, /Brain and Email Assistant voices are never used as/);
assert.doesNotMatch(voice, /email_assistant_voice_id/);
assert.match(voiceDefault, /bDTlr4ICxntY9qVWyL0o/);
assert.match(voiceDefault, /Sam Elliott – British Podcast Host/);
assert.match(voiceDefault, /source: "personal"/);
assert.match(voiceDefault, /source: "shared_default"/);
assert.match(emailAssistantVoiceConfig, /email_assistant_voice_id/);
assert.doesNotMatch(emailAssistantVoiceConfig, /outreach_voice_id/);

assert.match(prepare, /required: \["research", "strategy", "email", "voiceNote"\]/);
assert.match(prepare, /OUTREACH_VOICE_TARGET_WORDS/);
assert.match(prepare, /Personalisation matters more than hitting an exact word count/);
assert.match(prepare, /Always finish the final sentence cleanly/);
assert.match(prepare, /their exact company/);
assert.match(prepare, /strongest current verified fact/);
assert.match(prepare, /TRUTHFUL MOMENTUM RULE/);
assert.match(prepare, /gentle urgency without sounding pushy/);
assert.match(prepare, /verified_trigger/);
assert.match(prepare, /natural_next_moment/);
assert.match(prepare, /one exact complete sentence copied from the script/);
assert.match(prepare, /Never use "act now"/);
assert.match(prepare, /voiceIncludesWhyNow/);
assert.match(prepare, /includedInScript: voiceIncludesWhyNow/);
assert.match(prepare, /CAMPAIGN CONTRACT, this is the only permitted message purpose/);
assert.match(prepare, /CAMPAIGN VALUE TRANSLATION/);
assert.match(prepare, /focused mock interview in about five minutes/);
assert.match(prepare, /candidate and recruiter can both review the results/);
assert.match(prepare, /without another preparation call or extra administration/);
assert.match(prepare, /Keep that complete causal chain in the voice note/);
assert.match(prepare, /Do not carry this candidate preparation message into screening/);
assert.match(prepare, /Do not use an offer, use case or CTA from another campaign/);
assert.match(prepare, /one grounded angle permitted by the campaign contract/);
assert.match(prepare, /I hope you are doing well today\./);
assert.match(prepare, /welcoming, upbeat and positive/);
assert.match(prepare, /speaker is smiling and pleased/);
assert.match(prepare, /never rushed or overexcited/);
assert.match(prepare, /Do not use an exclamation mark in that opening/);
assert.match(prepare, /We are Interviewa/);
assert.match(prepare, /must never impersonate the salesperson/);
assert.match(prepare, /audio layer handles its pronunciation as "Interviewer"/);
assert.match(prepare, /prepareOutreachVoiceScriptForReview/);
assert.doesNotMatch(prepare, /Candidate training is the primary campaign angle/);
assert.match(prepare, /voice_status: "script_ready"/);
assert.match(editor, /Why act now/);
assert.match(editor, /verified current trigger/);
assert.match(editor, /next natural business moment/);
assert.match(editor, /Boolean\(whyNow && !whyNowIncluded\)/);
assert.match(prepare, /preserveReadyAudio/);

assert.match(generate, /resolveOutreachIdentity\(\)/);
assert.match(generate, /\.eq\("workspace_id", sender\.workspaceId\)/);
assert.match(generate, /\.eq\("sender_user_id", sender\.userId\)/);
assert.match(generate, /outreachVoiceScriptHash/);
assert.match(generate, /voice_status === "ready"/);
assert.match(generate, /reused: true/);
assert.match(generate, /OUTREACH_VOICE_BUCKET/);
assert.match(generate, /configuredVoiceNoteCostGbp/);
assert.match(generate, /assertOutreachVoiceWithinBudget/);
assert.match(generate, /message\.voice_script_approved_at/);
assert.match(generate, /message\.voice_script_approved_by !== sender\.userId/);
assert.match(generate, /message\.voice_script_approved_hash !== approvedHash/);
assert.match(generate, /Nothing has been charged/);
assert.match(generate, /One personal voice note is already being created/);
assert.match(generate, /outreachVoiceHasFalseSenderIdentity/);
assert.match(generate, /Use We are Interviewa instead/);
assert.match(generate, /Date\.now\(\) - 3 \* 60 \* 1000/);
assert.match(generate, /previous interrupted voice generation was released safely/i);
assert.ok(
  generate.indexOf("assertOutreachVoiceWithinBudget") <
    generate.indexOf('voice_status: "generating"'),
  "the cost guard must run before the provider call is claimed"
);
assert.match(generate, /voice_estimated_cost_gbp: budget\.estimatedCostGbp/);
assert.match(generate, /\.eq\("voice_script", script\)/);

assert.match(createScript, /resolveOutreachIdentity\(\)/);
assert.match(createScript, /\.eq\("workspace_id", sender\.workspaceId\)/);
assert.match(createScript, /\.eq\("sender_user_id", sender\.userId\)/);
assert.match(createScript, /\.eq\("assigned_to_user_id", sender\.userId\)/);
assert.match(createScript, /\.eq\("owner_id", sender\.userId\)/);
assert.match(createScript, /OPENAI_MODEL_LIVE/);
assert.doesNotMatch(createScript, /web_search/);
assert.doesNotMatch(createScript, /generateElevenLabsOutreachAudio/);
assert.doesNotMatch(createScript, /\/voice(?:["'`])/);
assert.match(createScript, /audioGenerated: false/);
assert.match(createScript, /emailPreserved: true/);
assert.match(createScript, /voice_status: "script_ready"/);
assert.match(createScript, /voice_audio_path: null/);
assert.match(createScript, /voice_script_approved_at: null/);
assert.match(createScript, /\.eq\("updated_at", message\.updated_at\)/);
assert.match(createScript, /Keep the full opening sentence at the same calm/);
assert.match(createScript, /Do not rush the opening/);
const createScriptUpdate = createScript.slice(
  createScript.indexOf('.update({'),
  createScript.indexOf('})\n      .eq("workspace_id"')
);
assert.doesNotMatch(createScriptUpdate, /subject:/);
assert.doesNotMatch(createScriptUpdate, /body_text:/);

assert.match(patchRoute, /voiceChanged/);
assert.match(patchRoute, /voice_audio_path = null/);
assert.match(patchRoute, /body\.approve_voice_script === true/);
assert.match(patchRoute, /outreachVoiceHasFalseSenderIdentity/);
assert.match(patchRoute, /existing\.strategy\?\.voiceUrgency\?\.whyNow/);
assert.match(patchRoute, /Keep the approved why now sentence in the voice pitch/);
assert.match(patchRoute, /voice_script_approved_at/);
assert.match(patchRoute, /kind: "voice_script_approved"/);
assert.match(patchRoute, /assertOutreachVoiceWithinBudget/);
assert.match(patchRoute, /voice_character_count = voiceApprovalBudget\.characters/);
assert.match(
  patchRoute,
  /voice_estimated_cost_gbp = voiceApprovalBudget\.estimatedCostGbp/
);
assert.match(patchRoute, /Generate and preview the personal voice note before approving/);
assert.match(queue, /voice_public_token/);
assert.match(queue, /voice_script_approved_at/);

assert.match(sender, /outreachVoicePublicUrl/);
assert.match(sender, /message\.voice_status === "ready"/);
assert.match(sender, /The personal voice note is not ready/);
assert.match(mail, /I’ve added a short personal voice message for you/);
assert.match(mail, /voiceNote\?:/);

assert.match(player, /robots: \{ index: false/);
assert.match(player, /PublicVoiceNotePlayer/);
assert.match(player, /ReturnToInboxButton/);
assert.doesNotMatch(player, /mailto:/);
assert.match(returnToInbox, /window\.opener\.focus\(\)/);
assert.match(returnToInbox, /window\.close\(\)/);
assert.match(returnToInbox, /window\.history\.back\(\)/);
assert.match(returnToInbox, /No new mail app has been opened/);
assert.match(audio, /createSignedUrl/);
assert.match(audio, /voice_public_token/);
assert.match(played, /kind: "voice_played"/);

assert.doesNotMatch(editor, /Approve script/);
assert.match(editor, /Generate voice · est/);
assert.match(editor, /one click approves the visible script/);
assert.doesNotMatch(editor, /Hear pronunciation/);
assert.doesNotMatch(editor, /SpeechSynthesisUtterance/);
assert.doesNotMatch(editor, /generated audio says/);
assert.match(editor, /Play personal voice note/);
assert.match(editor, /Refresh steady delivery/);
assert.match(editor, /Script missing/);
assert.match(editor, /Create script first/);
assert.match(editor, /No audio is generated by that action/);
assert.match(editor, /delivery profile has changed/);
assert.match(editor, /voice_generated_at/);
assert.match(editor, /OUTREACH_VOICE_HARD_MAX_CHARACTERS/);
assert.match(editor, /Complete sentences and useful personalisation take priority/);
assert.match(editor, /voice_estimated_cost_gbp/);
assert.match(outreachPage, /generateVoiceNote/);
assert.match(outreachPage, /approve_voice_script: true/);
assert.doesNotMatch(outreachPage, /approveVoiceScript/);
assert.match(outreachPage, /OutreachVoiceNoteEditor/);
assert.match(outreachPage, /queueRowNeedsVoiceScript/);
assert.match(outreachPage, /queueRowNeedsPreparation/);
assert.match(outreachPage, /hasCurrentReadyVoice/);
assert.match(outreachPage, /visibleScript === savedScript/);
assert.match(outreachPage, /voice scripts to complete/);
assert.match(outreachPage, /Complete current wave/);
assert.match(outreachPage, /Create voice script/);
assert.match(outreachPage, /Refresh draft/);
assert.match(outreachPage, /emailPreserved !== true/);
assert.match(outreachPage, /Complete and generate the personal voice note before queueing/);
assert.match(today, /generateVoiceNote/);
assert.match(today, /approve_voice_script: true/);
assert.doesNotMatch(today, /approveVoiceScript/);
assert.match(today, /OutreachVoiceNoteEditor/);
assert.match(today, /queueRowNeedsVoiceScript/);
assert.match(today, /queueRowNeedsPreparation/);
assert.match(today, /Create voice script/);
assert.match(today, /Refresh draft/);
assert.match(today, /emailPreserved !== true/);

assert.match(profile, /outreach_voice_id/);
assert.match(profile, /\.eq\("user_id", scope\.userId\)/);
assert.match(voice, /\.from\("salesperson_profiles"\)/);
assert.match(voice, /\.eq\("workspace_id", sender\.workspaceId\)/);
assert.match(voice, /\.eq\("user_id", sender\.userId\)/);
assert.match(generate, /resolveOutreachVoiceConfig\(sender\)/);
assert.match(voiceLibrary, /\/v2\/voices/);
assert.match(voiceLibrary, /voice_type: "default"/);
assert.match(voiceLibrary, /preview_url/);
assert.match(voiceLibrary, /\/v1\/voices\/\$\{encodeURIComponent\(id\)\}/);
assert.match(voiceLibraryRoute, /requireRequestScope\(\)/);
assert.match(voiceLibraryRoute, /Sign in to choose your voice/);
assert.match(voiceLibraryRoute, /Cache-Control": "private/);
assert.match(salesProfileRoute, /validateSalespersonVoiceSelection/);
assert.doesNotMatch(salesProfileRoute, /validateOutreachVoiceSelection/);
assert.match(salesProfileRoute, /input\.outreachVoiceId !== previous\.outreachVoiceId/);
assert.match(salesProfilePage, /Separate voice settings/);
assert.match(salesProfilePage, /Outreach uses the shared Sam Elliott default/);
assert.match(salesProfilePage, /Outreach campaign voice/);
assert.match(salesProfilePage, /Shared default used across this salesperson's Outreach campaigns/);
assert.match(salesProfilePage, /Use shared default/);
assert.match(salesProfilePage, /Outreach falls back to the shared default/);
assert.match(salesProfilePage, /Email Assistant audio still stops safely/);
assert.match(salesProfilePage, /Neither can borrow Brain&apos;s voice or the other product&apos;s setting/);
assert.match(salesProfilePage, /voice\.previewUrl/);
assert.match(campaignRoute, /legacy field describes campaign writing only/);
assert.match(campaignRoute, /tone:[\s\S]*style:[\s\S]*rules:[\s\S]*signature:/);
assert.doesNotMatch(
  campaignRoute,
  /(?:outreach_voice_id|voice_provider_voice_id|providerVoiceId|elevenlabsVoiceId)/
);
assert.match(assistantRoute, /campaign voice object controls writing tone only/);
assert.match(assistantRoute, /never select or override the salesperson's audio voice/);

const policyModule = await import("../lib/outreach-voice-policy.ts");
const voiceDefaultModule = await import("../lib/outreach-voice-default.ts");
assert.equal(
  voiceDefaultModule.OUTREACH_SHARED_DEFAULT_VOICE_ID,
  "bDTlr4ICxntY9qVWyL0o"
);
assert.equal(
  voiceDefaultModule.OUTREACH_SHARED_DEFAULT_VOICE_NAME,
  "Sam Elliott – British Podcast Host"
);
const salespersonA = voiceDefaultModule.selectEffectiveOutreachVoice({
  outreach_voice_id: "personal-voice-user-a",
  outreach_voice_name: "User A voice",
});
const salespersonB = voiceDefaultModule.selectEffectiveOutreachVoice({
  outreach_voice_id: null,
  outreach_voice_name: null,
});
assert.deepEqual(salespersonA, {
  voiceId: "personal-voice-user-a",
  voiceName: "User A voice",
  source: "personal",
});
assert.deepEqual(salespersonB, {
  voiceId: "bDTlr4ICxntY9qVWyL0o",
  voiceName: "Sam Elliott – British Podcast Host",
  source: "shared_default",
});
assert.notEqual(
  salespersonA.voiceId,
  salespersonB.voiceId,
  "one salesperson's override must never leak into another salesperson's fallback"
);
assert.equal(policyModule.OUTREACH_VOICE_TARGET_WORDS, 100);
assert.equal(policyModule.OUTREACH_VOICE_PREFERRED_MIN_WORDS, 80);
assert.equal(policyModule.OUTREACH_VOICE_PREFERRED_MAX_WORDS, 120);
assert.equal(policyModule.OUTREACH_VOICE_HARD_MAX_WORDS, 150);
assert.equal(
  policyModule.outreachVoiceSpeechText("A note from Interviewa"),
  "A note from Interviewer"
);
assert.doesNotMatch(
  policyModule.outreachVoiceSpeechText(
    "Hi Alex, I hope you are doing well today. We are Interviewa and this could help."
  ),
  /<break/i,
  "outreach audio must not insert artificial pause tags"
);
const safeGeneratedScript = policyModule.prepareOutreachVoiceScriptForReview({
  script:
    "I'm Lee Nazari from Interviewa. We help recruiters prepare candidates before client interviews.",
  recipientFirstName: "Alex",
  senderName: "Lee Nazari",
});
assert.match(safeGeneratedScript, /^Hi Alex, I hope you are doing well today\./);
assert.match(safeGeneratedScript, /We are Interviewa\./);
assert.doesNotMatch(safeGeneratedScript, /I'm Lee|I am Lee|This is Lee/i);
const replacedOldOpening = policyModule.prepareOutreachVoiceScriptForReview({
  script:
    "Hi Alex, how are you doing? We are Interviewa. Here is why this could help.",
  recipientFirstName: "Alex",
  senderName: "Lee Nazari",
});
assert.match(replacedOldOpening, /^Hi Alex, I hope you are doing well today\./);
assert.equal((replacedOldOpening.match(/Hi Alex/g) || []).length, 1);
assert.doesNotMatch(replacedOldOpening, /how are you doing/i);
const dedupedWarmOpening = policyModule.prepareOutreachVoiceScriptForReview({
  script:
    "Hi Alex, I hope you're doing well today. We are Interviewa. Here is why this could help.",
  recipientFirstName: "Alex",
  senderName: "Lee Nazari",
});
assert.equal((dedupedWarmOpening.match(/hope you are doing well today/i) || []).length, 1);
assert.equal(
  policyModule.outreachVoiceHasFalseSenderIdentity(
    "I'm Cam from Interviewa.",
    "Cam Smith"
  ),
  true
);
assert.equal(
  policyModule.outreachVoiceHasFalseSenderIdentity(
    "I’m Jordan Reed from Interviewa.",
    "Lee Nazari"
  ),
  true
);
assert.equal(
  policyModule.estimateOutreachVoiceCostGbp("x".repeat(800)),
  0.05
);
assert.equal(
  policyModule.estimateOutreachVoiceCostGbp("x".repeat(1200)),
  0.075
);

console.log("Shared-default and salesperson-scoped outreach voice checks passed");
