export type SalesTutorialDemo = {
  label: string;
  title: string;
  facts: string[];
  outcome: string;
};

export type SalesTutorialStep = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  checklist: string[];
  href: string | null;
  target: string | null;
  demo: SalesTutorialDemo;
};

export const SALES_TUTORIAL_GUIDE_KEY = "sales_workflow_v3";
export const SENDPILOT_TUTORIAL_GUIDE_KEY = "sendpilot_workflow_v1";

export const SALES_OUTREACH_TUTORIAL_STEPS: SalesTutorialStep[] = [
  {
    id: "overview",
    eyebrow: "Safe practice run",
    title: "Follow one fictional lead from first look to next action",
    body:
      "Meet Maya Patel at the fictional Northstar Talent. This walkthrough previews the complete sales flow without claiming a lead, running research, sending a message or changing the pipeline.",
    checklist: [
      "Complete your personal setup once",
      "Work outreach, replies and calls as one connected flow",
      "Finish every meaningful interaction with a dated next action",
    ],
    href: null,
    target: null,
    demo: {
      label: "Fictional prospect",
      title: "Maya Patel · Northstar Talent",
      facts: [
        "Available in the shared lead pool",
        "No outreach has been sent",
        "No pipeline opportunity exists yet",
      ],
      outcome:
        "Practice outcome · a booked demo with one clean CRM record and a dated follow up.",
    },
  },
  {
    id: "readiness",
    eyebrow: "Step 1",
    title: "Make your account ready before selling",
    body:
      "Each salesperson uses their own mailbox, calendar, sending identity, coaching preferences and private LiveCoach session. The readiness screen shows exactly what still needs attention.",
    checklist: [
      "Connect one mailbox and its calendar",
      "Complete your personal sales style and sending identity",
      "Confirm your personal notetaker and leads are ready",
    ],
    href: "/settings/readiness",
    target: "account-readiness",
    demo: {
      label: "Practice readiness",
      title: "Your private sales setup",
      facts: [
        "Email and calendar · ready",
        "Personal LiveCoach notetaker · ready",
        "Sales style and target customers · saved",
      ],
      outcome:
        "Only this salesperson's connected accounts and private coaching context are used.",
    },
  },
  {
    id: "campaign",
    eyebrow: "Step 2",
    title: "Choose the campaign, message and next step",
    body:
      "The campaign defines who you are contacting, why Interviewa is relevant and what response you want. Start with one email, then add another step only when it has a clear purpose.",
    checklist: [
      "Confirm the audience, offer and campaign goal",
      "Choose the call to action for this campaign or message",
      "Keep approval on and add email, phone or LinkedIn steps only when needed",
      "A voice note is optional and is generated only after its script is approved",
    ],
    href: "/crm/outreach?tab=campaign",
    target: "campaign-setup",
    demo: {
      label: "Practice campaign",
      title: "Technical recruiter preparation",
      facts: [
        "Goal · book a 10 minute demo",
        "Sequence · one opening email",
        "Call to action · reply to arrange the demo",
      ],
      outcome:
        "The campaign controls the research angle, email, voice script and follow up.",
    },
  },
  {
    id: "claim",
    eyebrow: "Step 3",
    title: "Claim the right lead and place them in today’s flow",
    body:
      "Use Prospects to find suitable unassigned people across campaigns. Claiming makes you responsible for the contact and prevents another salesperson sending overlapping outreach.",
    checklist: [
      "Filter for unassigned prospects or the campaign you need",
      "Check the person and company are genuinely relevant",
      "Claim the contact, then work the ranked Sales Today queue",
    ],
    href: "/crm/outreach?tab=prospects",
    target: "prospect-pool",
    demo: {
      label: "Practice assignment",
      title: "Maya enters your queue",
      facts: [
        "Before · available to the sales team",
        "After claim · assigned only to you",
        "Today · ranked against your other unsent leads",
      ],
      outcome:
        "Team wide email protection still checks that nobody else has already contacted Maya.",
    },
  },
  {
    id: "research",
    eyebrow: "Step 4",
    title: "Research, inspect and approve without waiting",
    body:
      "Queue research and keep using the CRM while it runs in the background. LiveCoach prepares evidence, an email and a voice script, but it never contacts the prospect at this stage.",
    checklist: [
      "Open the evidence and check every current claim",
      "Edit anything vague, inaccurate or unlike your voice",
      "Generate the optional audio only when the script is worth using",
      "Approve the exact email and attachment you intend to send",
    ],
    href: "/crm/outreach",
    target: "outreach-queue",
    demo: {
      label: "Practice research result",
      title: "A relevant engineering vacancy found",
      facts: [
        "Source · official company job board",
        "Email draft · ready for review",
        "Voice script · ready, audio not charged yet",
      ],
      outcome:
        "Nothing has been sent. The salesperson remains responsible for factual approval.",
    },
  },
  {
    id: "reply",
    eyebrow: "Step 5",
    title: "Send safely and turn the reply into action",
    body:
      "Approved messages join the paced sending queue. A reply stops the sequence, creates an owner-only notification and stays linked to the same prospect and client context.",
    checklist: [
      "Confirm the visible sender, recipient and final message",
      "Let the paced queue send without holding the screen open",
      "Open important replies from Notifications or Sales Today",
      "Book the meeting or save the next response against the same record",
    ],
    href: "/crm/outreach?tab=replies",
    target: "reply-handover",
    demo: {
      label: "Practice reply",
      title: "Maya replied · interested",
      facts: [
        "Sequence · stopped automatically",
        "Notification · sent to the lead owner",
        "Next move · arrange a 10 minute demo",
      ],
      outcome:
        "The exact reply and relevant thread context remain attached to Maya's record.",
    },
  },
  {
    id: "call",
    eyebrow: "Step 6",
    title: "Prepare, start and capture the conversation",
    body:
      "Open the scheduled call from LiveCoach, build the focus if useful, then start the meeting and notetaker together. Phone calls can be logged afterwards by typing or voice.",
    checklist: [
      "Check the correct person, company and meeting link before starting",
      "Use your private focus, live coaching and call summary",
      "Download the transcript when one was captured",
      "Use Log a call for an unrecorded phone or face to face conversation",
    ],
    href: "/crm/calls",
    target: "calls-workspace",
    demo: {
      label: "Practice call",
      title: "Demo with Maya · Monday 10:30",
      facts: [
        "Focus · prove the five minute candidate preparation flow",
        "Notetaker · your own private LiveCoach session",
        "Fallback · dictate a manual call recap",
      ],
      outcome:
        "The transcript, notes, coaching and summary feed the correct client and the next call.",
    },
  },
  {
    id: "pipeline",
    eyebrow: "Step 7",
    title: "Advance one canonical deal and date the next move",
    body:
      "Create or advance a pipeline opportunity only when commercial interest is real. Stage records where the deal is. Win outlook records the evidence. The next action keeps it moving.",
    checklist: [
      "Confirm the owner and lifecycle stage",
      "Keep value and win outlook evidence based",
      "Add one clear next action with a due date",
      "Sales Today, notifications and the daily brief bring the action back at the right time",
    ],
    href: "/crm/revenue",
    target: "pipeline-assignment",
    demo: {
      label: "Practice pipeline",
      title: "Northstar Talent · candidate preparation pilot",
      facts: [
        "Stage · discovery",
        "Win outlook · possible, based on Maya's reply",
        "Next action · send pilot link tomorrow",
      ],
      outcome:
        "One deal, one history and one dated next action now drive every CRM view.",
    },
  },
];

export const SALES_TUTORIAL_LAST_STEP =
  SALES_OUTREACH_TUTORIAL_STEPS.length - 1;

export const SENDPILOT_TUTORIAL_STEPS: SalesTutorialStep[] = [
  {
    id: "sendpilot-overview",
    eyebrow: "Safe guided walkthrough",
    title: "Use LiveCoach to control SendPilot outreach",
    body:
      "LiveCoach remains the source of truth for the lead, assignment, approval and history. SendPilot carries out the LinkedIn sequence after you approve one exact handoff.",
    checklist: [
      "Connect only your own SendPilot account",
      "Map one LiveCoach campaign to one running SendPilot campaign",
      "Approve each exact lead before SendPilot receives it",
    ],
    href: null,
    target: null,
    demo: {
      label: "Practice flow",
      title: "Maya Patel · Northstar Talent",
      facts: [
        "LiveCoach owns Maya's CRM record",
        "No LinkedIn action has been taken",
        "The walkthrough never hands Maya to SendPilot",
      ],
      outcome:
        "Practice outcome · understand the complete handoff and reply flow without contacting anyone.",
    },
  },
  {
    id: "sendpilot-connect",
    eyebrow: "Step 1",
    title: "Connect your own SendPilot account",
    body:
      "Create a workspace API key in SendPilot, then paste it into your private LiveCoach settings. LiveCoach verifies the active LinkedIn sender and never shows the saved key again.",
    checklist: [
      "Use the SendPilot account connected to your own LinkedIn profile",
      "Open SendPilot Integrations and API Keys to create the key",
      "Paste it into LiveCoach and confirm the displayed sender is you",
    ],
    href: "/settings#sendpilot-inbox",
    target: "sendpilot-settings",
    demo: {
      label: "Expected result",
      title: "Your SendPilot identity is connected",
      facts: [
        "The API key is encrypted",
        "The connection belongs only to this login",
        "Another salesperson cannot use your sender",
      ],
      outcome:
        "This connection gives LiveCoach controlled lead handoff and inbound activity access.",
    },
  },
  {
    id: "sendpilot-webhook",
    eyebrow: "Step 2",
    title: "Send replies and activity back to LiveCoach",
    body:
      "Copy the personal webhook URL from LiveCoach into SendPilot. Select the five supported events, then save the one-time webhook secret back in LiveCoach.",
    checklist: [
      "Select reply received and message sent",
      "Select connection request sent and accepted",
      "Select lead updated, then save the webhook secret",
    ],
    href: "/settings#sendpilot-inbox",
    target: "sendpilot-settings",
    demo: {
      label: "Expected result",
      title: "Automatic CRM events are active",
      facts: [
        "Replies return to the correct lead owner",
        "Missed events are repaired by the inbound safety sync",
        "No lead is enrolled by the safety sync",
      ],
      outcome:
        "LiveCoach can now alert the correct salesperson and stop overlapping outreach after a reply.",
    },
  },
  {
    id: "sendpilot-map",
    eyebrow: "Step 3",
    title: "Map the matching campaigns once",
    body:
      "Build and start the LinkedIn sequence inside SendPilot first. Then map that running campaign to the matching LiveCoach campaign in your settings.",
    checklist: [
      "Start the SendPilot campaign before trying to map it",
      "Match the same audience and sales purpose in both systems",
      "Do not duplicate the SendPilot cadence as extra manual LinkedIn steps",
    ],
    href: "/settings#sendpilot-inbox",
    target: "sendpilot-settings",
    demo: {
      label: "Practice mapping",
      title: "Workable screening · Workable LinkedIn",
      facts: [
        "LiveCoach campaign · active",
        "SendPilot campaign · started",
        "Private mapping · only for this salesperson",
      ],
      outcome:
        "When a LinkedIn step becomes due, LiveCoach knows the exact SendPilot campaign to use.",
    },
  },
  {
    id: "sendpilot-prepare",
    eyebrow: "Step 4",
    title: "Prepare and claim the lead in LiveCoach",
    body:
      "Choose the prospect in LiveCoach first. Check their LinkedIn profile, campaign fit, assignment and contact history before the LinkedIn step becomes eligible.",
    checklist: [
      "Claim an unassigned lead so one salesperson owns the contact",
      "Confirm the LinkedIn URL belongs to the correct person",
      "Review prior email, reply and suppression history",
    ],
    href: "/crm/outreach?tab=prospects",
    target: "prospect-pool",
    demo: {
      label: "Practice lead",
      title: "Maya is ready for review",
      facts: [
        "Assigned to you",
        "No team member has contacted her",
        "LinkedIn identity has been checked",
      ],
      outcome:
        "LiveCoach blocks duplicates and conflicting outreach before any provider handoff.",
    },
  },
  {
    id: "sendpilot-handoff",
    eyebrow: "Step 5",
    title: "Approve one exact SendPilot handoff",
    body:
      "When the mapped LinkedIn step is due, use Approve for SendPilot on the lead. Confirm the exact person and campaign. SendPilot then owns delivery of its LinkedIn sequence.",
    checklist: [
      "Check the person and mapped campaign in the confirmation",
      "Approve only the lead you intend to enrol",
      "Look for the SendPilot queued or active status before moving on",
    ],
    href: "/crm/outreach",
    target: "outreach-queue",
    demo: {
      label: "Practice handoff",
      title: "Approve Maya for Workable LinkedIn",
      facts: [
        "Daily team safety rules are checked again",
        "Duplicate provider enrolment is blocked",
        "LiveCoach keeps the canonical activity history",
      ],
      outcome:
        "One confirmation starts the mapped provider sequence. The CRM remains usable while it runs.",
    },
  },
  {
    id: "sendpilot-replies",
    eyebrow: "Step 6",
    title: "Work every reply from LiveCoach",
    body:
      "SendPilot reports activity and replies back to the same lead. LiveCoach notifies the owner, stops conflicting outreach and keeps the next action with the CRM record.",
    checklist: [
      "Open the reply from Notifications, Sales Today or Replies",
      "Respond from the correct LinkedIn account",
      "Log the outcome and add one dated next action",
    ],
    href: "/crm/outreach?tab=replies",
    target: "reply-handover",
    demo: {
      label: "Practice reply",
      title: "Maya replied · interested",
      facts: [
        "Owner notification · created",
        "Conflicting email outreach · stopped",
        "Next move · arrange a 10 minute demo",
      ],
      outcome:
        "The reply, prospect, campaign and next action stay connected in one LiveCoach record.",
    },
  },
];

export const SENDPILOT_TUTORIAL_LAST_STEP =
  SENDPILOT_TUTORIAL_STEPS.length - 1;
