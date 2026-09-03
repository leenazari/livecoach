import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultOutreachCampaignCtaConfig,
  deduplicateOutreachEmailSignoff,
  effectiveOutreachCtaConfig,
  ensureOutreachEmailCampaignCta,
  ensureOutreachEmailDemoReplyCta,
  ensureOutreachEmailSimpleOptOut,
  ensureOutreachEmailWithoutSalesCta,
  ensureOutreachVoiceCampaignCta,
  ensureOutreachVoiceDemoReplyCta,
  hasOutreachCampaignCta,
  hasOutreachDemoReplyCta,
  hasOutreachSalesCallToAction,
  OUTREACH_EMAIL_DEMO_REPLY_CTA,
  OUTREACH_SIMPLE_OPT_OUT,
  OUTREACH_VOICE_DEMO_REPLY_CTA,
  outreachEmailEndsWithDemoReplyCta,
  outreachVoiceEndsWithDemoReplyCta,
  resolveOutreachCampaignCta,
  removeOutreachVoiceSalesCta,
  sanitizeOutreachCampaignCtaConfig,
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
assert.equal(hasOutreachSalesCallToAction(withoutCta), false);

const repeatedSignoff = ensureOutreachEmailSimpleOptOut({
  body: `Hi Sam,\n\nWould it be useful to see this on one live role?\n\n${OUTREACH_SIMPLE_OPT_OUT}\nBest regards, Kamm.\n\nBest regards, Kamm.`,
  signoff: "Best regards, Kamm.",
});
assert.equal(
  repeatedSignoff,
  `Hi Sam,\n\nWould it be useful to see this on one live role?\n\n${OUTREACH_SIMPLE_OPT_OUT}\n\nBest regards, Kamm.`,
  "A sign off joined to the opt out and repeated afterwards must be repaired"
);
assert.equal(
  repeatedSignoff.match(/Best regards, Kamm\./gi)?.length,
  1,
  "The final email must contain the salesperson sign off exactly once"
);
assert.equal(
  deduplicateOutreachEmailSignoff({
    body: "Thanks for coming back to me.\n\nBest wishes,\nLee\n\nBest wishes,\nLee",
    signoff: "Best wishes,\nLee",
  }),
  "Thanks for coming back to me.\n\nBest wishes,\nLee",
  "Non campaign email drafts must also remove a repeated sign off"
);
assert.equal(
  deduplicateOutreachEmailSignoff({
    body: "Thanks for coming back to me.\n\nBest wishes, Lee\n\nBest wishes, Lee",
  }),
  "Thanks for coming back to me.\n\nBest wishes, Lee",
  "Same line sign offs must be repaired even when no profile sign off is supplied"
);
assert.equal(
  deduplicateOutreachEmailSignoff({
    body: "Thanks for coming back to me.\n\nBest regards, Kamm.\n\nBest regards, Kamm.",
  }),
  "Thanks for coming back to me.\n\nBest regards, Kamm.",
  "Best regards must also appear only once without an explicit profile sign off"
);
assert.equal(
  hasOutreachSalesCallToAction(
    "If a quick call would help, reply and we can arrange one."
  ),
  true,
  "Natural call or demo invitations should satisfy the optional guidance"
);
assert.equal(
  hasOutreachSalesCallToAction(
    "We reviewed the call notes and the demonstration results yesterday."
  ),
  false,
  "Past call references must not be mistaken for a call to action"
);
assert.equal(
  hasOutreachSalesCallToAction(
    "If you would like to book a 10 minute demo, just reply to this email and I will arrange it."
  ),
  true,
  "A timed demo invitation must satisfy the CTA advice"
);

const workableCta = resolveOutreachCampaignCta({
  campaignGoal:
    "Book a focused Interviewa screening demonstration or start a free trial using the existing Workable integration",
  campaignOfferAngle:
    "Interviewa connects directly with Workable to screen candidates consistently before human review.",
  sequencePurpose:
    "Lead with their existing Workable workflow and always invite a quick screening demonstration",
  sequenceGuidance:
    "End with a clear invitation to reply for a quick 10 minute demonstration or a free trial on one current Workable vacancy.",
});
assert.deepEqual(
  workableCta,
  {
    kind: "demo",
    durationMinutes: 10,
    label: "10 minute demo",
    emailText:
      "Would you be open to booking a 10 minute demo? Just reply to this email and I will arrange it.",
    voiceText:
      "Would you be open to booking a 10 minute demo? Just reply to this email and we will arrange it.",
    source: "sequence_guidance",
  },
  "The Workable campaign wording must become one deterministic CTA policy"
);
const workableEmail = ensureOutreachEmailCampaignCta({
  body: `Hi Sam,\n\nYour Workable workflow looks relevant. Would reducing screening admin help?\n\nIf a quick chat would help, reply and I can arrange one.\n\nBest regards,\nKamm`,
  signoff: "Best regards,\nKamm",
  policy: workableCta,
});
assert.equal(
  workableEmail,
  `Hi Sam,\n\nYour Workable workflow looks relevant. Would reducing screening admin help?\n\n${OUTREACH_SIMPLE_OPT_OUT}\n\n${workableCta.emailText}\n\nBest regards,\nKamm`,
  "The campaign CTA must replace a weaker model CTA instead of appearing twice"
);
assert.equal(hasOutreachCampaignCta(workableEmail, workableCta), true);
assert.equal(outreachEmailEndsWithDemoReplyCta(workableEmail), true);
const workableVoice = ensureOutreachVoiceCampaignCta({
  script:
    "Hi Sam, I hope you are doing well today. We are Interviewa. The easiest way to judge the integration is on one live role. If a quick call would help, reply and we can arrange one.",
  policy: workableCta,
});
assert.equal(
  workableVoice.endsWith(workableCta.voiceText),
  true,
  "The voice script must inherit the same campaign next step"
);
assert.equal(
  workableVoice.match(/reply/gi)?.length,
  1,
  "The voice script must not retain two competing CTAs"
);
assert.equal(hasOutreachCampaignCta(workableVoice, workableCta), true);
assert.equal(
  resolveOutreachCampaignCta({
    campaignGoal: "Book a 10 minute demo",
    sequenceGuidance: "Do not include a CTA in this exact step",
  }),
  null,
  "A deliberate sequence opt out must still take precedence"
);
assert.equal(
  resolveOutreachCampaignCta({
    campaignGoal: "Build a useful relationship with recruitment leaders",
    campaignOfferAngle: "Candidate preparation without extra admin",
  }),
  null,
  "Campaigns without an explicit next step must keep CTA guidance optional"
);

const structuredWorkableCta = resolveOutreachCampaignCta({
  campaignGoal: "Build a useful relationship",
  campaignCtaConfig: {
    type: "reply_demo",
    label: "Book a 10 minute demo",
    url: "",
  },
});
assert.equal(structuredWorkableCta?.source, "campaign_config");
assert.equal(structuredWorkableCta?.durationMinutes, 10);
assert.equal(structuredWorkableCta?.delivery, "reply");
assert.match(structuredWorkableCta?.emailText || "", /10 minute demo/i);

const linkCta = resolveOutreachCampaignCta({
  campaignCtaConfig: {
    type: "video",
    label: "Watch the two minute overview",
    url: "https://interviewa.com/demo",
  },
});
assert.equal(linkCta?.kind, "video");
assert.equal(linkCta?.delivery, "shared_link");
assert.equal(linkCta?.url, "https://interviewa.com/demo");
const linkEmail = ensureOutreachEmailCampaignCta({
  body: "Hi Sam,\n\nThis looks relevant.\n\nBest,\nLee",
  signoff: "Best,\nLee",
  policy: linkCta,
});
assert.equal(linkEmail.match(/https:\/\/interviewa\.com\/demo/g)?.length, 1);
assert.equal(hasOutreachCampaignCta(linkEmail, linkCta), true);

const personalBookingCta = resolveOutreachCampaignCta({
  campaignCtaConfig: defaultOutreachCampaignCtaConfig(
    "personal_booking_link"
  ),
  personalBookingUrl: "https://calendar.example/kamm",
});
assert.equal(personalBookingCta?.delivery, "personal_booking_link");
assert.equal(personalBookingCta?.url, "https://calendar.example/kamm");
assert.match(personalBookingCta?.emailText || "", /calendar\.example\/kamm/);
assert.match(personalBookingCta?.voiceText || "", /click the booking link/i);

const personSelection = effectiveOutreachCtaConfig({
  enrolmentCtaConfig: defaultOutreachCampaignCtaConfig("personal_booking_link"),
  campaignCtaConfig: defaultOutreachCampaignCtaConfig("voice_note"),
});
assert.equal(personSelection.source, "enrolment_config");
assert.equal(personSelection.inherited, false);
assert.equal(personSelection.config.type, "personal_booking_link");
const personCta = resolveOutreachCampaignCta({
  campaignGoal: "Build a useful relationship",
  sequenceGuidance: "Do not include a CTA in this broad sequence",
  campaignCtaConfig: personSelection.config,
  configuredSource: personSelection.source,
  personalBookingUrl: "https://calendar.example/lee",
});
assert.equal(personCta?.source, "enrolment_config");
assert.equal(personCta?.delivery, "personal_booking_link");
assert.match(personCta?.emailText || "", /calendar\.example\/lee/);
assert.match(personCta?.voiceText || "", /click the booking link/i);

const inheritedSelection = effectiveOutreachCtaConfig({
  campaignCtaConfig: defaultOutreachCampaignCtaConfig("reply_demo"),
});
assert.equal(inheritedSelection.source, "campaign_config");
assert.equal(inheritedSelection.inherited, true);
assert.equal(inheritedSelection.config.type, "reply_demo");

const voiceNoteCta = resolveOutreachCampaignCta({
  campaignCtaConfig: defaultOutreachCampaignCtaConfig("voice_note"),
});
assert.equal(voiceNoteCta?.delivery, "voice_note");
assert.equal(hasOutreachSalesCallToAction(voiceNoteCta?.emailText), true);
assert.equal(
  resolveOutreachCampaignCta({
    campaignCtaConfig: defaultOutreachCampaignCtaConfig("none"),
  }),
  null
);
assert.equal(
  hasOutreachSalesCallToAction(
    ensureOutreachEmailWithoutSalesCta({
      body: "Hi Sam.\n\nWould you be open to a quick demo? Reply and I will arrange it.\n\nBest,\nLee",
      signoff: "Best,\nLee",
    })
  ),
  false,
  "A campaign that deliberately selects no CTA must remove a generated sales CTA"
);
assert.equal(
  removeOutreachVoiceSalesCta(
    "This is relevant to your next hiring round. Would you be open to a quick demo?"
  ),
  "This is relevant to your next hiring round.",
  "A no CTA campaign must remove the generated final spoken invitation"
);
assert.equal(
  sanitizeOutreachCampaignCtaConfig(
    { type: "link", label: "Open this", url: "http://unsafe.example" },
    "auto"
  ).error,
  "Campaign call to action links must use a complete secure HTTPS address"
);

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
const replyDraft = [
  read("app/api/crm/outreach/replies/[id]/draft/route.ts"),
  read("lib/outreach-positive-reply.ts"),
].join("\n");
const sendQueue = read("lib/outreach-send-queue.ts");
const outreachPage = read("app/crm/outreach/page.tsx");
const outreachToday = read("components/crm/OutreachTodayLane.tsx");
const voiceEditor = read("components/crm/OutreachVoiceNoteEditor.tsx");
const ctaAdvice = read("components/crm/OutreachCtaAdvice.tsx");
const ctaEditor = read("components/crm/CampaignCtaEditor.tsx");
const prospectCtaSelector = read("components/crm/ProspectCtaSelector.tsx");
const campaignCreate = read("app/api/crm/outreach/campaigns/route.ts");
const campaignUpdate = read("app/api/crm/outreach/campaigns/[id]/route.ts");
const migration = read("supabase/migrations/20260902164344_campaign_call_to_action.sql");
const prospectCtaRoute = read("app/api/crm/outreach/enrolments/[id]/cta/route.ts");
const prospectCtaMigration = read("supabase/migrations/20260902172640_prospect_cta_overrides.sql");

assert.match(prepareRoute, /ensureOutreachEmailSimpleOptOut/);
assert.match(prepareRoute, /preferred default, not a validity rule/i);
assert.match(prepareRoute, /missing call to action must never make the draft invalid or stop it being approved/i);
assert.doesNotMatch(prepareRoute, /ensureOutreachEmailDemoReplyCta/);
assert.doesNotMatch(prepareRoute, /ensureOutreachVoiceDemoReplyCta/);
assert.match(prepareRoute, /resolveOutreachCampaignCta/);
assert.match(prepareRoute, /ensureOutreachEmailCampaignCta/);
assert.match(prepareRoute, /ensureOutreachVoiceCampaignCta/);
assert.match(prepareRoute, /enrolmentCtaConfig: enrolment\.cta_config/);
assert.match(prepareRoute, /campaignCtaConfig: selectedCta\.config/);
assert.match(prepareRoute, /configuredSource: selectedCta\.source/);
assert.match(prepareRoute, /personalBookingUrl/);
assert.doesNotMatch(prepareRoute, /exact mandatory CTA/);
assert.doesNotMatch(messageRoute, /outreachEmailEndsWithDemoReplyCta/);
assert.doesNotMatch(messageRoute, /outreachVoiceEndsWithDemoReplyCta/);
assert.match(messageRoute, /Keep the simple opt-out line before approving/);
assert.match(messageRoute, /eq\("workspace_id", sender\.workspaceId\)/);
assert.match(messageRoute, /eq\("sender_user_id", sender\.userId\)/);
assert.match(voiceScriptRoute, /recommended, not required/i);
assert.match(voiceScriptRoute, /missing CTA must never invalidate the script or block approval/i);
assert.match(voiceScriptRoute, /enrolmentCtaConfig: enrolment\.cta_config/);
assert.match(voiceScriptRoute, /campaignCtaConfig: selectedCta\.config/);
assert.doesNotMatch(voiceScriptRoute, /failed the demo reply check/);
assert.match(brain, /sales call to action is optional/i);
assert.doesNotMatch(brain, /ensureOutreachEmailDemoReplyCta/);
assert.doesNotMatch(brainEmail, /outreach_demo_reply_cta_missing/);
assert.doesNotMatch(brainEmail, /outreachEmailEndsWithDemoReplyCta/);
assert.match(brainEmail, /outreach_opt_out_missing/);
assert.match(replyDraft, /ensureOutreachEmailSimpleOptOut/);
assert.doesNotMatch(sendQueue, /ensureOutreachEmailDemoReplyCta/);
assert.match(outreachPage, /OutreachCtaAdvice/);
assert.match(outreachToday, /OutreachCtaAdvice/);
assert.match(voiceEditor, /recommended when it fits/);
assert.match(ctaAdvice, /role="note"/);
assert.match(ctaAdvice, /can still be queued without it/);
assert.match(ctaAdvice, /Got it/);
assert.match(ctaAdvice, /workspaceId/);
assert.match(ctaAdvice, /userId/);
assert.match(ctaAdvice, /window\.localStorage\.setItem/);
assert.match(ctaAdvice, /voiceNoteReady/);
assert.match(ctaAdvice, /campaignHasCta/);
assert.match(ctaAdvice, /campaignOptedOut/);
assert.doesNotMatch(ctaAdvice, /Do not show CTA tips again/);
assert.doesNotMatch(ctaAdvice, /window\.confirm|role="alert"/);
assert.match(ctaEditor, /What should the prospect do next\?/);
assert.match(ctaEditor, /Reply to book a demo/);
assert.match(ctaEditor, /Use my booking link/);
assert.match(ctaEditor, /Watch a video/);
assert.match(ctaEditor, /Listen to the voice note/);
assert.match(ctaEditor, /No CTA/);
assert.match(outreachPage, /CampaignCtaEditor/);
assert.match(outreachPage, /ProspectCtaSelector/);
assert.match(outreachPage, /cta_config: campaign\.cta_config/);
assert.match(outreachToday, /ProspectCtaSelector/);
assert.match(campaignCreate, /sanitizeOutreachCampaignCtaConfig/);
assert.match(campaignCreate, /"reply_demo"/);
assert.match(campaignUpdate, /patch\.cta_config = result\.config/);
assert.match(migration, /add column if not exists cta_config jsonb not null/);
assert.match(migration, /lower\(name\) = 'workable'/);
assert.match(prospectCtaRoute, /assigned_to_user_id !== account\.userId/);
assert.match(prospectCtaRoute, /cta_config: ctaConfig/);
assert.match(prospectCtaRoute, /draftNeedsRefresh/);
assert.doesNotMatch(prospectCtaRoute, /bookingUrl/);
assert.match(prospectCtaSelector, /Recommended ·/);
assert.match(prospectCtaSelector, /Click my demo booking link/);
assert.match(prospectCtaSelector, /Refresh the draft to apply it/);
assert.match(prospectCtaMigration, /add column if not exists cta_config jsonb/);
assert.match(prospectCtaMigration, /cta_config is null/);
assert.doesNotMatch(prospectCtaMigration, /personalBookingUrl/);
assert.match(brain, /\.eq\("workspace_id", requestScope\.workspaceId\)/);
assert.match(brain, /cta_config/);
assert.doesNotMatch(outreachPage, /call to action[^\n]{0,160}throw new Error/i);
assert.doesNotMatch(outreachToday, /call to action[^\n]{0,160}setError/i);

console.log("Optional outreach call to action checks passed");
