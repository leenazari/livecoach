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
const emailAssistantVoiceConfig = read("lib/email-assistant-voice-config.ts");
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
assert.match(voice, /if \(!personalVoiceId\)/);
assert.match(voice, /voiceId: personalVoiceId/);
assert.match(voice, /Brain's voice is never used for outreach/);
assert.doesNotMatch(voice, /email_assistant_voice_id/);
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
assert.match(prepare, /Do not use an offer, use case or CTA from another campaign/);
assert.match(prepare, /one grounded angle permitted by the campaign contract/);
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
assert.match(generate, /Date\.now\(\) - 3 \* 60 \* 1000/);
assert.match(generate, /previous interrupted voice generation was released safely/i);
assert.ok(
  generate.indexOf("assertOutreachVoiceWithinBudget") <
    generate.indexOf('voice_status: "generating"'),
  "the cost guard must run before the provider call is claimed"
);
assert.match(generate, /voice_estimated_cost_gbp: budget\.estimatedCostGbp/);
assert.match(generate, /\.eq\("voice_script", script\)/);

assert.match(patchRoute, /voiceChanged/);
assert.match(patchRoute, /voice_audio_path = null/);
assert.match(patchRoute, /body\.approve_voice_script === true/);
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
assert.match(mail, /I recorded a short personal message for you/);
assert.match(mail, /voiceNote\?:/);

assert.match(player, /robots: \{ index: false/);
assert.match(player, /PublicVoiceNotePlayer/);
assert.match(audio, /createSignedUrl/);
assert.match(audio, /voice_public_token/);
assert.match(played, /kind: "voice_played"/);

assert.match(editor, /1 · Approve script/);
assert.match(editor, /2 · Generate voice · est/);
assert.match(editor, /Approving the words costs nothing/);
assert.match(editor, /OUTREACH_VOICE_HARD_MAX_CHARACTERS/);
assert.match(editor, /Complete sentences and useful personalisation take priority/);
assert.match(editor, /voice_estimated_cost_gbp/);
assert.match(outreachPage, /generateVoiceNote/);
assert.match(outreachPage, /approveVoiceScript/);
assert.match(outreachPage, /OutreachVoiceNoteEditor/);
assert.match(today, /generateVoiceNote/);
assert.match(today, /approveVoiceScript/);
assert.match(today, /OutreachVoiceNoteEditor/);

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
assert.match(salesProfilePage, /Listen free, choose the voice for Email Assistant replies/);
assert.match(salesProfilePage, /independent from each other and from Brain&apos;s voice/);
assert.match(salesProfilePage, /Outreach campaign voice/);
assert.match(salesProfilePage, /Used only for Outreach campaign voice notes/);
assert.match(salesProfilePage, /Both voices belong only to your login/);
assert.match(salesProfilePage, /that feature&apos;s audio generation stops safely/);
assert.match(salesProfilePage, /Outreach never borrows the Email Assistant voice/);
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
assert.equal(policyModule.OUTREACH_VOICE_TARGET_WORDS, 100);
assert.equal(policyModule.OUTREACH_VOICE_PREFERRED_MIN_WORDS, 80);
assert.equal(policyModule.OUTREACH_VOICE_PREFERRED_MAX_WORDS, 120);
assert.equal(policyModule.OUTREACH_VOICE_HARD_MAX_WORDS, 150);
assert.equal(
  policyModule.estimateOutreachVoiceCostGbp("x".repeat(800)),
  0.05
);
assert.equal(
  policyModule.estimateOutreachVoiceCostGbp("x".repeat(1200)),
  0.075
);

console.log("Salesperson-scoped outreach voice note checks passed");
