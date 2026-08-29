import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureOutreachEmailDemoReplyCta,
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

const prepareRoute = read("app/api/crm/outreach/[id]/prepare/route.ts");
const messageRoute = read("app/api/crm/outreach/messages/[id]/route.ts");
const brain = read("app/api/crm/assistant/route.ts");
const brainEmail = read("app/api/crm/assistant/email/route.ts");
const replyDraft = read("app/api/crm/outreach/replies/[id]/draft/route.ts");
const sendQueue = read("lib/outreach-send-queue.ts");

assert.match(prepareRoute, /ensureOutreachEmailDemoReplyCta/);
assert.match(prepareRoute, /ensureOutreachVoiceDemoReplyCta/);
assert.match(prepareRoute, /OUTREACH_EMAIL_DEMO_REPLY_CTA/);
assert.match(prepareRoute, /OUTREACH_VOICE_DEMO_REPLY_CTA/);
assert.match(messageRoute, /!isReply && !outreachEmailEndsWithDemoReplyCta/);
assert.match(messageRoute, /!isReply && !outreachVoiceEndsWithDemoReplyCta/);
assert.match(brain, /ensureOutreachEmailDemoReplyCta/);
assert.match(brainEmail, /outreachEmailEndsWithDemoReplyCta/);
assert.doesNotMatch(replyDraft, /outreach-demo-reply-cta/);
assert.doesNotMatch(sendQueue, /ensureOutreachEmailDemoReplyCta/);

console.log("Outbound quick demo reply CTA checks passed");
