import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const policy = await import(
  fileURLToPath(new URL("../lib/email-reply-policy.ts", import.meta.url))
);

const labelsFor = (text) =>
  policy.detectEmailReplyPolicyTopics(text).flatMap((topic) => topic.labels);

const asked = (text, label) => {
  assert.ok(
    labelsFor(text).includes(label),
    `expected ${JSON.stringify(text)} to detect ${label}`
  );
};

asked("Are you GDPR compliant?", "gdpr");
asked("Please send your data protection summary.", "data protection");
asked("What is your data storage location?", "data storage");
asked("Is our data stored in the UK?", "data storage");
asked("Can you confirm data hosting?", "hosting");
asked("Where is the platform hosted?", "hosting");
asked("What is your data residency?", "data residency");
asked("What retention period do you use?", "retention");
asked("What is your deletion policy?", "deletion");
asked("Please delete our candidate data.", "deletion");
asked("Can your security team answer this?", "security");
asked("Do customers get audit logs?", "audit logs");
asked("Is there an audit log?", "audit logs");
asked("Are you SOC 2 certified?", "soc 2");
asked("Are you SOC2 certified?", "soc 2");
asked("Are you ISO 27001 certified?", "iso 27001");
asked("Are you ISO-27001 certified?", "iso 27001");
asked("Subject: ISO27001 questionnaire\nPlease advise.", "iso 27001");

for (const ordinary of [
  "Could we catch up next week?",
  "Thanks, Tuesday works for a demo.",
  "Please host the call on Teams.",
  "Can you store the notes after the meeting?",
  "We need a secure link for the recording.",
]) {
  assert.deepEqual(policy.detectEmailReplyPolicyTopics(ordinary), [], ordinary);
}

const approvedTitle =
  "Standard Response: GDPR, Data Storage & Security - data protection, hosting, retention, deletion, security certifications, audit log objection";
const approvedLesson = {
  title: approvedTitle,
  created_at: "2026-11-01T09:00:00.000Z",
  visibility: "team",
  status: "approved",
  content: JSON.stringify({
    title: "Standard Response: GDPR, Data Storage & Security",
    principle: "Answer with the approved standard response.",
    standardResponse:
      "Interviewa is fully GDPR compliant and certified to Cyber Essentials. We're currently working towards SOC 2 and ISO 27001.",
    avoid: [
      "Do not say Interviewa is SOC 2 or ISO 27001 certified. Say 'working towards' until certification is confirmed.",
      "Do not complete a security questionnaire yourself. Escalate security questionnaires to Lee.",
    ],
    liveCoachSafeguard:
      "Use the standard response as written. Say 'working towards' SOC 2 / ISO 27001 until certified. Escalate security questionnaires to Lee.",
  }),
};
const unrelated = {
  title: "Calibrate AI fluency before discovery",
  created_at: "2026-11-02T09:00:00.000Z",
  content: JSON.stringify({ principle: "Ask about their workflow." }),
};
const tagOnly = {
  title: "Procurement answer",
  created_at: "2026-10-01T09:00:00.000Z",
  content: JSON.stringify({
    tags: ["gdpr", "data residency"],
    standardResponse: "We're currently working towards SOC 2 and ISO 27001.",
  }),
};
const specific = {
  title: "SOC 2 status",
  created_at: "2026-11-02T10:00:00.000Z",
  content: JSON.stringify({
    standardResponse: "We're currently working towards SOC 2.",
    avoid: ["Escalate security questionnaires to Lee."],
  }),
};

assert.equal(
  policy.selectPolicyLessons([unrelated, approvedLesson], policy.detectEmailReplyPolicyTopics("Are you GDPR compliant?"))[0],
  approvedLesson
);
assert.equal(
  policy.selectPolicyLessons([unrelated], policy.detectEmailReplyPolicyTopics("Where is our data hosted?"))
    .length,
  0
);
assert.equal(
  policy.selectPolicyLessons([tagOnly], policy.detectEmailReplyPolicyTopics("Please confirm GDPR."))[0],
  tagOnly
);
assert.equal(
  policy.selectPolicyLessons(
    [approvedLesson, specific],
    policy.detectEmailReplyPolicyTopics("Are you SOC 2 certified?")
  )[0],
  specific,
  "A lesson whose title matches the asked term wins"
);
assert.equal(
  policy.selectPolicyLessons(
    [approvedLesson],
    policy.detectEmailReplyPolicyTopics("Are you SOC2 or ISO27001 certified?")
  )[0],
  approvedLesson,
  "The general approved lesson still matches when the title uses the topic family"
);

const guidance = policy.formatPolicyGuidance(
  [approvedLesson],
  policy.detectEmailReplyPolicyTopics("Are you SOC 2 certified?")
);
assert.match(guidance, /working towards/i);
assert.match(guidance, /Escalate security questionnaires to Lee/);
assert.match(guidance, /Never claim SOC 2 or ISO 27001 certification/);
assert.doesNotMatch(guidance, /217fbbf3-18d3-492d-9e1d-4b1bb1766f8f/);

const basePrompt = "PRIVATE CRM FACTS\n{facts}";
const baseSystem = "Write one approval-only reply draft.";
const baseDraft =
  "Hello, Tuesday works for a short call. Interviewa is certified to Cyber Essentials.";

let lookups = 0;
const failed = await policy.resolveEmailReplyPolicyGuidance({
  emailText: "Are you GDPR compliant, and are you SOC 2 certified?",
  enabled: true,
  loadLessons: async () => {
    lookups += 1;
    throw new Error("permission denied for lessons");
  },
});
assert.equal(failed, "");
assert.equal(lookups, 1);
assert.equal(policy.appendEmailReplyPolicyGuidance(basePrompt, failed), basePrompt);
assert.equal(baseSystem + policy.policySystemAddendum(failed), baseSystem);
assert.equal(policy.applyPolicyGuidanceToDraft(baseDraft, failed), baseDraft);
assert.equal(policy.preserveWorkingTowardsCertifications(baseDraft), baseDraft);

let calledWhileDisabled = false;
const disabled = await policy.resolveEmailReplyPolicyGuidance({
  emailText: "Please confirm GDPR and data retention.",
  enabled: false,
  loadLessons: async () => {
    calledWhileDisabled = true;
    return [approvedLesson];
  },
});
assert.equal(disabled, "");
assert.equal(calledWhileDisabled, false);
assert.equal(policy.appendEmailReplyPolicyGuidance(basePrompt, disabled), basePrompt);

let calledForOrdinaryMail = false;
const ordinary = await policy.resolveEmailReplyPolicyGuidance({
  emailText: "Could we catch up next week?",
  enabled: true,
  loadLessons: async () => {
    calledForOrdinaryMail = true;
    return [approvedLesson];
  },
});
assert.equal(ordinary, "");
assert.equal(calledForOrdinaryMail, false);

const loaded = await policy.resolveEmailReplyPolicyGuidance({
  emailText: "Can you confirm data residency and retention?",
  enabled: true,
  loadLessons: async () => [unrelated, approvedLesson],
});
assert.match(loaded, /working towards SOC 2 and ISO 27001/);
assert.match(loaded, /Lee/);
const withGuidance = policy.appendEmailReplyPolicyGuidance(basePrompt, loaded);
assert.notEqual(withGuidance, basePrompt);
assert.match(withGuidance, /APPROVED COMPANY GUIDANCE/);
assert.match(baseSystem + policy.policySystemAddendum(loaded), /must not be sent/);

const faithful =
  "Interviewa is fully GDPR compliant and certified to Cyber Essentials. We're currently working towards SOC 2 and ISO 27001.";
assert.equal(policy.applyPolicyGuidanceToDraft(faithful, loaded), faithful);
assert.equal(
  policy.applyPolicyGuidanceToDraft("We are SOC 2 certified.", loaded),
  "We are working towards SOC 2."
);
assert.equal(
  policy.applyPolicyGuidanceToDraft("We are not ISO 27001 certified.", loaded),
  "We are working towards ISO 27001."
);
assert.equal(
  policy.applyPolicyGuidanceToDraft("We aren't SOC 2 certified.", loaded),
  "We are working towards SOC 2."
);
assert.equal(
  policy.applyPolicyGuidanceToDraft("We are certified to SOC 2 and ISO 27001.", loaded),
  "We are working towards SOC 2 and ISO 27001."
);
assert.equal(
  policy.applyPolicyGuidanceToDraft("Interviewa is SOC 2 and ISO 27001 certified.", loaded),
  "Interviewa is working towards SOC 2 and ISO 27001."
);
assert.equal(
  policy.applyPolicyGuidanceToDraft("We hold an ISO 27001 certificate.", loaded),
  "We hold an ISO 27001 (working towards)."
);
assert.match(
  policy.applyPolicyGuidanceToDraft("Interviewa is certified to Cyber Essentials.", loaded),
  /certified to Cyber Essentials/
);
const questionnaire =
  "If your security or procurement team needs more detail, we're happy to complete your security questionnaire or set up a call with our technical team.";
assert.match(
  policy.applyPolicyGuidanceToDraft(questionnaire, loaded),
  /Lee can take the security questionnaire from here/
);
assert.equal(policy.applyPolicyGuidanceToDraft(questionnaire, ""), questionnaire);

assert.equal(policy.emailReplyPolicyGuidanceEnabled({}), true);
assert.equal(policy.emailReplyPolicyGuidanceEnabled({ EMAIL_REPLY_POLICY_GUIDANCE: "" }), true);
assert.equal(policy.emailReplyPolicyGuidanceEnabled({ EMAIL_REPLY_POLICY_GUIDANCE: "0" }), false);
assert.equal(policy.emailReplyPolicyGuidanceEnabled({ EMAIL_REPLY_POLICY_GUIDANCE: "off" }), false);
assert.equal(policy.emailReplyPolicyGuidanceEnabled({ EMAIL_REPLY_POLICY_GUIDANCE: "false" }), false);
assert.equal(policy.emailReplyPolicyGuidanceEnabled({ EMAIL_REPLY_POLICY_GUIDANCE: "no" }), false);
assert.equal(policy.emailReplyPolicyGuidanceEnabled({ EMAIL_REPLY_POLICY_GUIDANCE: "1" }), true);

const lookup = read("lib/email-reply-policy-lookup.ts");
const taskEmail = read("lib/task-email.ts");
const assistant = read("lib/email-assistant.ts");
const positive = read("lib/outreach-positive-reply.ts");
const example = read(".env.example");
assert.match(lookup, /from\("lessons"\)/);
assert.match(lookup, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(lookup, /\.eq\("status", "approved"\)/);
assert.match(lookup, /\.eq\("visibility", "team"\)/);
assert.match(lookup, /supabaseAdmin/);
assert.doesNotMatch(lookup, /217fbbf3-18d3-492d-9e1d-4b1bb1766f8f/);
assert.doesNotMatch(read("lib/email-reply-policy.ts"), /217fbbf3-18d3-492d-9e1d-4b1bb1766f8f/);
assert.doesNotMatch(`${lookup}\n${read("lib/email-reply-policy.ts")}`, /sendConnectedMail|schedule\(|messages\.send/);
assert.match(taskEmail, /isInboundReply\s*\?\s*\n?\s*loadEmailReplyPolicyGuidance/);
assert.match(taskEmail, /appendEmailReplyPolicyGuidance\(/);
assert.match(taskEmail, /This remains a draft until the salesperson separately presses Approve and send/);
assert.match(assistant, /loadEmailReplyPolicyGuidance\(/);
assert.match(assistant, /This is a draft only\. Never claim it was sent/);
assert.match(positive, /loadEmailReplyPolicyGuidance\(/);
assert.match(positive, /status: "draft"/);
assert.match(example, /EMAIL_REPLY_POLICY_GUIDANCE=0/);

console.log("Email reply policy guidance passed. Topic detection, lesson matching, and a failed lookup leave the draft unchanged.");
