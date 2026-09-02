import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureOutreachEmailDemoReplyCta,
  ensureOutreachEmailSimpleOptOut,
  ensureOutreachVoiceDemoReplyCta,
  hasOutreachDemoReplyCta,
  OUTREACH_EMAIL_DEMO_REPLY_CTA,
  OUTREACH_SIMPLE_OPT_OUT,
  OUTREACH_VOICE_DEMO_REPLY_CTA,
  outreachEmailEndsWithDemoReplyCta,
  outreachVoiceEndsWithDemoReplyCta,
} from "../lib/outreach-demo-reply-cta.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const prepared = ensureOutreachEmailDemoReplyCta({
  body: `Hi Sam,\n\nYour current hiring round looks relevant. Would a short example help?\n\nBest,\nLee\n\nIf this is not relevant, tell me and I will not follow up.`,
  signoff: "Best,\nLee",
});
assert.equal(
  prepared,
  `Hi Sam,\n\nYour current hiring round looks relevant. Would a short example help?\n\n${OUTREACH_SIMPLE_OPT_OUT}\n\n${OUTREACH_EMAIL_DEMO_REPLY_CTA}\n\nBest,\nLee`
);
assert(outreachEmailEndsWithDemoReplyCta(prepared));
assert.equal(
  ensureOutreachEmailDemoReplyCta({
    body: prepared,
    signoff: "Best,\nLee",
  }),
  prepared,
  "Repeated preparation must not duplicate the CTA"
);
assert.equal(
  prepared.match(/book a quick demo/gi)?.length,
  1,
  "The email must carry one standard demo CTA"
);

const titledSignature = ensureOutreachEmailDemoReplyCta({
  body: `Hi Sam,\n\nWould a short example help?\n\nLee Nazari\nCEO, Interviewa`,
});
assert(
  titledSignature.endsWith(
    `${OUTREACH_EMAIL_DEMO_REPLY_CTA}\n\nLee Nazari\nCEO, Interviewa`
  )
);

const longPrepared = ensureOutreachEmailDemoReplyCta({
  body: `${"Useful evidence. ".repeat(500)}\n\nLee`,
  signoff: "Lee",
  maximumCharacters: 4000,
});
assert(longPrepared.length <= 4000);
assert(outreachEmailEndsWithDemoReplyCta(longPrepared));

const voice = ensureOutreachVoiceDemoReplyCta(
  "Hi Sam, how are you doing? We are Interviewa. The easiest way to judge this is on your next live role."
);
assert(voice.endsWith(OUTREACH_VOICE_DEMO_REPLY_CTA));
assert(outreachVoiceEndsWithDemoReplyCta(voice));
assert.equal(ensureOutreachVoiceDemoReplyCta(voice), voice);
assert(hasOutreachDemoReplyCta(voice));

const withoutCta = ensureOutreachEmailSimpleOptOut({
  body: `Hi Sam,\n\nYour current hiring round looks relevant.\n\nBest,\nLee`,
  signoff: "Best,\nLee",
});
assert.equal(
  withoutCta,
  `Hi Sam,\n\nYour current hiring round looks relevant.\n\n${OUTREACH_SIMPLE_OPT_OUT}\n\nBest,\nLee`
);
assert.equal(hasOutreachDemoReplyCta(withoutCta), false);

const optionalCtaPreserved = ensureOutreachEmailSimpleOptOut({
  body: prepared,
  signoff: "Best,\nLee",
});
assert.equal(
  optionalCtaPreserved.match(/book a quick demo/gi)?.length,
  1,
  "A deliberately included CTA must be preserved"
);

const prepareRoute = read("app/api/crm/outreach/[id]/prepare/route.ts");
const messageRoute = read("app/api/crm/outreach/messages/[id]/route.ts");
const voiceScriptRoute = read("app/api/crm/outreach/messages/[id]/voice-script/route.ts");
const brain = read("app/api/crm/assistant/route.ts");
const brainEmail = read("app/api/crm/assistant/email/route.ts");
const replyDraft = read("app/api/crm/outreach/replies/[id]/draft/route.ts");
const sendQueue = read("lib/outreach-send-queue.ts");
const outreachPage = read("app/crm/outreach/page.tsx");
const outreachToday = read("components/crm/OutreachTodayLane.tsx");
const voiceEditor = read("components/crm/OutreachVoiceNoteEditor.tsx");

assert.match(prepareRoute, /ensureOutreachEmailSimpleOptOut/);
assert.match(prepareRoute, /sales call to action is optional/i);
assert.doesNotMatch(prepareRoute, /ensureOutreachEmailDemoReplyCta/);
assert.doesNotMatch(prepareRoute, /ensureOutreachVoiceDemoReplyCta/);
assert.doesNotMatch(prepareRoute, /exact mandatory CTA/);
assert.doesNotMatch(messageRoute, /outreachEmailEndsWithDemoReplyCta/);
assert.doesNotMatch(messageRoute, /outreachVoiceEndsWithDemoReplyCta/);
assert.match(messageRoute, /Keep the simple opt-out line before approving/);
assert.match(messageRoute, /eq\("workspace_id", sender\.workspaceId\)/);
assert.match(messageRoute, /eq\("sender_user_id", sender\.userId\)/);
assert.match(voiceScriptRoute, /sales call to action is optional/i);
assert.doesNotMatch(voiceScriptRoute, /failed the demo reply check/);
assert.match(brain, /sales call to action is optional/i);
assert.doesNotMatch(brain, /ensureOutreachEmailDemoReplyCta/);
assert.doesNotMatch(brainEmail, /outreach_demo_reply_cta_missing/);
assert.doesNotMatch(brainEmail, /outreachEmailEndsWithDemoReplyCta/);
assert.match(brainEmail, /outreach_opt_out_missing/);
assert.doesNotMatch(replyDraft, /outreach-demo-reply-cta/);
assert.doesNotMatch(sendQueue, /ensureOutreachEmailDemoReplyCta/);
assert.match(outreachPage, /A sales call to action is optional/);
assert.match(outreachToday, /A sales call to action is optional/);
assert.match(voiceEditor, /A sales call to action is optional/);

console.log("Optional outreach call to action checks passed");
