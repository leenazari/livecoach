export const OUTREACH_SEQUENCE_MAX_STEPS = 6;

export const OUTREACH_SEQUENCE_CONTENT_TYPES = [
  "plain",
  "insight",
  "case_study",
  "video",
  "close_loop",
] as const;

export const OUTREACH_SEQUENCE_CHANNELS = [
  "email",
  "linkedin",
  "phone",
] as const;

export const OUTREACH_SEQUENCE_ACTION_TYPES = [
  "email",
  "linkedin_view",
  "linkedin_like",
  "linkedin_connect",
  "linkedin_message",
  "manual_call",
] as const;

export type OutreachSequenceContentType =
  (typeof OUTREACH_SEQUENCE_CONTENT_TYPES)[number];
export type OutreachSequenceChannel =
  (typeof OUTREACH_SEQUENCE_CHANNELS)[number];
export type OutreachSequenceActionType =
  (typeof OUTREACH_SEQUENCE_ACTION_TYPES)[number];

export type OutreachSequenceStep = {
  step: number;
  channel?: OutreachSequenceChannel;
  actionType?: OutreachSequenceActionType;
  delayDays: number;
  purpose: string;
  contentType?: OutreachSequenceContentType;
  guidance?: string;
  assetUrl?: string | null;
};

export type OutreachSequenceActionTemplate = {
  key: string;
  channel: OutreachSequenceChannel;
  actionType: OutreachSequenceActionType;
  contentType?: OutreachSequenceContentType;
  label: string;
  shortLabel: string;
  icon: string;
  purpose: string;
  guidance: string;
};

export const OUTREACH_SEQUENCE_TEMPLATES: ReadonlyArray<
  OutreachSequenceActionTemplate & {
    channel: "email";
    actionType: "email";
    contentType: OutreachSequenceContentType;
  }
> = [
  {
    key: "email_plain",
    channel: "email",
    actionType: "email",
    contentType: "plain",
    label: "Relevant email",
    shortLabel: "Email",
    icon: "✉",
    purpose: "Open a relevant conversation with one easy question",
    guidance: "Lead with one verified reason this person should care now.",
  },
  {
    key: "email_insight",
    channel: "email",
    actionType: "email",
    contentType: "insight",
    label: "Useful insight",
    shortLabel: "Insight",
    icon: "◆",
    purpose: "Add a useful new reason to respond",
    guidance:
      "Share one concise observation that helps this prospect make a better decision.",
  },
  {
    key: "email_case_study",
    channel: "email",
    actionType: "email",
    contentType: "case_study",
    label: "Proof point",
    shortLabel: "Proof",
    icon: "✓",
    purpose: "Build confidence with approved evidence",
    guidance:
      "Use only a verified case study or approved product proof. Never invent a result.",
  },
  {
    key: "email_video",
    channel: "email",
    actionType: "email",
    contentType: "video",
    label: "Video or demo",
    shortLabel: "Video",
    icon: "▶",
    purpose: "Make the value easy to see",
    guidance:
      "Introduce the approved video or demo link in one natural sentence.",
  },
  {
    key: "email_close_loop",
    channel: "email",
    actionType: "email",
    contentType: "close_loop",
    label: "Close the loop",
    shortLabel: "Close",
    icon: "◎",
    purpose: "Close the loop without pressure",
    guidance:
      "Make it easy to reply yes, later, or not relevant. Do not repeat the opening pitch.",
  },
];

export const OUTREACH_SEQUENCE_MANUAL_TEMPLATES: ReadonlyArray<OutreachSequenceActionTemplate> = [
  {
    key: "linkedin_view",
    channel: "linkedin",
    actionType: "linkedin_view",
    label: "View LinkedIn profile",
    shortLabel: "View profile",
    icon: "in",
    purpose: "Review the person and confirm the outreach still fits",
    guidance:
      "Open the saved LinkedIn profile yourself. Check identity and relevance before continuing.",
  },
  {
    key: "linkedin_like",
    channel: "linkedin",
    actionType: "linkedin_like",
    label: "Like a relevant post",
    shortLabel: "Like post",
    icon: "♡",
    purpose: "Create a light and genuine point of familiarity",
    guidance:
      "Only like a post you genuinely find relevant. LiveCoach never performs this action for you.",
  },
  {
    key: "linkedin_connect",
    channel: "linkedin",
    actionType: "linkedin_connect",
    label: "Send connection request",
    shortLabel: "Connect",
    icon: "+",
    purpose: "Invite a relevant prospect to connect",
    guidance:
      "Open LinkedIn and send the request yourself. Keep any note factual, brief and natural.",
  },
  {
    key: "linkedin_message",
    channel: "linkedin",
    actionType: "linkedin_message",
    label: "Send LinkedIn message",
    shortLabel: "Message",
    icon: "↗",
    purpose: "Continue the conversation with a concise personal message",
    guidance:
      "Write and send this manually in LinkedIn. Do not repeat an email that has already been sent.",
  },
  {
    key: "manual_call",
    channel: "phone",
    actionType: "manual_call",
    label: "Manual phone call",
    shortLabel: "Phone call",
    icon: "☎",
    purpose: "Call the prospect and log the factual outcome",
    guidance:
      "Call from your normal phone, then log what happened and the agreed next action.",
  },
];

export const OUTREACH_SEQUENCE_ACTION_TEMPLATES: ReadonlyArray<OutreachSequenceActionTemplate> = [
  ...OUTREACH_SEQUENCE_TEMPLATES,
  ...OUTREACH_SEQUENCE_MANUAL_TEMPLATES,
];

export type OutreachSequencePreset = {
  id: string;
  name: string;
  description: string;
  sequence: OutreachSequenceStep[];
};

function emailStep(
  contentType: OutreachSequenceContentType,
  index: number,
  delayDays?: number
) {
  return {
    ...createOutreachSequenceStep(contentType, index),
    ...(delayDays == null ? {} : { delayDays }),
  };
}

function manualStep(
  actionType: Exclude<OutreachSequenceActionType, "email">,
  index: number,
  delayDays?: number
) {
  return {
    ...createOutreachActionStep(actionType, index),
    ...(delayDays == null ? {} : { delayDays }),
  };
}

const DEFAULT_SEQUENCE: OutreachSequenceStep[] = [
  emailStep("plain", 0),
  emailStep("insight", 1),
  emailStep("close_loop", 2, 7),
];

export const OUTREACH_SEQUENCE_PRESETS: ReadonlyArray<OutreachSequencePreset> = [
  {
    id: "concise_three_touch",
    name: "Concise three touch",
    description: "Relevant opening, useful follow up, then a respectful close.",
    sequence: DEFAULT_SEQUENCE,
  },
  {
    id: "proof_led",
    name: "Proof led",
    description: "Open naturally, add approved proof, then make the next step easy.",
    sequence: [
      emailStep("plain", 0),
      emailStep("case_study", 1, 3),
      emailStep("close_loop", 2, 6),
    ],
  },
  {
    id: "video_led",
    name: "Video led",
    description: "Earn interest first, share an approved video, then close the loop.",
    sequence: [
      emailStep("plain", 0),
      emailStep("video", 1, 3),
      emailStep("close_loop", 2, 6),
    ],
  },
  {
    id: "linkedin_warm_up",
    name: "Manual LinkedIn warm up",
    description: "Human LinkedIn checks around two approval gated emails.",
    sequence: [
      manualStep("linkedin_view", 0),
      manualStep("linkedin_like", 1, 1),
      emailStep("plain", 2, 1),
      manualStep("linkedin_connect", 3, 3),
      emailStep("close_loop", 4, 4),
    ],
  },
  {
    id: "phone_first",
    name: "Phone first",
    description: "Log a personal call, then use email only when a follow up is useful.",
    sequence: [
      manualStep("manual_call", 0),
      emailStep("insight", 1, 1),
      emailStep("close_loop", 2, 5),
    ],
  },
];

export function createOutreachSequenceStep(
  contentType: OutreachSequenceContentType,
  index: number
): OutreachSequenceStep {
  const template =
    OUTREACH_SEQUENCE_TEMPLATES.find(
      (item) => item.contentType === contentType
    ) || OUTREACH_SEQUENCE_TEMPLATES[0];
  return {
    step: index + 1,
    channel: "email",
    actionType: "email",
    delayDays: index === 0 ? 0 : 3,
    purpose: template.purpose,
    contentType: template.contentType,
    guidance: template.guidance,
    assetUrl: null,
  };
}

export function createOutreachActionStep(
  actionType: OutreachSequenceActionType,
  index: number
): OutreachSequenceStep {
  if (actionType === "email") return createOutreachSequenceStep("plain", index);
  const template =
    OUTREACH_SEQUENCE_MANUAL_TEMPLATES.find(
      (item) => item.actionType === actionType
    ) || OUTREACH_SEQUENCE_MANUAL_TEMPLATES[0];
  return {
    step: index + 1,
    channel: template.channel,
    actionType: template.actionType,
    delayDays: index === 0 ? 0 : 3,
    purpose: template.purpose,
    guidance: template.guidance,
    assetUrl: null,
  };
}

export function defaultOutreachSequence(): OutreachSequenceStep[] {
  return DEFAULT_SEQUENCE.map((step) => ({ ...step }));
}

export function outreachSequencePreset(id: string): OutreachSequenceStep[] {
  const preset = OUTREACH_SEQUENCE_PRESETS.find((item) => item.id === id);
  return (preset?.sequence || DEFAULT_SEQUENCE).map((step) => ({ ...step }));
}

export function renumberOutreachSequence(
  sequence: OutreachSequenceStep[]
): OutreachSequenceStep[] {
  return sequence.map((step, index) => ({
    ...step,
    step: index + 1,
    delayDays: index === 0 ? 0 : step.delayDays,
  }));
}

export function moveOutreachSequenceStep(
  sequence: OutreachSequenceStep[],
  fromIndex: number,
  toIndex: number
): OutreachSequenceStep[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= sequence.length ||
    toIndex >= sequence.length
  ) {
    return renumberOutreachSequence(sequence);
  }
  const next = sequence.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return renumberOutreachSequence(next);
}

export function outreachSequenceStepAt(
  sequence: unknown,
  stepNumber: number
): OutreachSequenceStep | null {
  const result = sanitizeOutreachSequence(sequence);
  if (result.error) return null;
  return (
    result.sequence.find((step) => step.step === Number(stepNumber)) || null
  );
}

export function isManualOutreachSequenceStep(
  step: OutreachSequenceStep | null | undefined
) {
  return Boolean(step && (step.channel || "email") !== "email");
}

function isValidChannelAction(
  channel: OutreachSequenceChannel,
  actionType: OutreachSequenceActionType
) {
  if (channel === "email") return actionType === "email";
  if (channel === "phone") return actionType === "manual_call";
  return actionType.startsWith("linkedin_");
}

export function outreachSequenceValidationError(
  sequence: OutreachSequenceStep[]
): string | null {
  if (!sequence.length) return "Add at least one sequence step";
  if (sequence.length > OUTREACH_SEQUENCE_MAX_STEPS) {
    return `A campaign can have up to ${OUTREACH_SEQUENCE_MAX_STEPS} steps`;
  }
  for (let index = 0; index < sequence.length; index += 1) {
    const step = sequence[index];
    const channel = step.channel || "email";
    const actionType = step.actionType || (channel === "email" ? "email" : null);
    if (!OUTREACH_SEQUENCE_CHANNELS.includes(channel)) {
      return `Sequence step ${index + 1} has an unsupported channel`;
    }
    if (
      !actionType ||
      !OUTREACH_SEQUENCE_ACTION_TYPES.includes(actionType) ||
      !isValidChannelAction(channel, actionType)
    ) {
      return `Sequence step ${index + 1} has an unsupported action`;
    }
    if (!String(step?.purpose || "").trim()) {
      return `Sequence step ${index + 1} needs a purpose`;
    }
    if (
      index > 0 &&
      (!Number.isFinite(step.delayDays) ||
        step.delayDays < 1 ||
        step.delayDays > 30)
    ) {
      return `Sequence step ${index + 1} wait days must be between 1 and 30`;
    }
    const assetUrl = String(step?.assetUrl || "").trim();
    if (assetUrl && !/^https:\/\//i.test(assetUrl)) {
      return `Sequence step ${index + 1} asset link must start with https://`;
    }
  }
  return null;
}

export function sanitizeOutreachSequence(
  input: unknown
): { sequence: OutreachSequenceStep[]; error: string | null } {
  if (!Array.isArray(input)) {
    return { sequence: defaultOutreachSequence(), error: null };
  }
  if (input.length > OUTREACH_SEQUENCE_MAX_STEPS) {
    return {
      sequence: [],
      error: `A campaign can have up to ${OUTREACH_SEQUENCE_MAX_STEPS} steps`,
    };
  }
  const sequence = input.map((raw: any, index) => {
    const assetUrl =
      typeof raw?.assetUrl === "string" ? raw.assetUrl.trim() : "";
    const rawChannel = String(raw?.channel || "email");
    const channel = OUTREACH_SEQUENCE_CHANNELS.includes(rawChannel as any)
      ? (rawChannel as OutreachSequenceChannel)
      : "email";
    const fallbackAction = channel === "email"
      ? "email"
      : channel === "phone"
        ? "manual_call"
        : "linkedin_view";
    const rawAction = String(raw?.actionType || fallbackAction);
    const actionType = OUTREACH_SEQUENCE_ACTION_TYPES.includes(rawAction as any)
      ? (rawAction as OutreachSequenceActionType)
      : fallbackAction;
    const contentType = OUTREACH_SEQUENCE_CONTENT_TYPES.includes(
      raw?.contentType
    )
      ? raw.contentType
      : channel === "email"
        ? "plain"
        : undefined;
    return {
      step: index + 1,
      channel,
      actionType,
      delayDays:
        index === 0
          ? 0
          : Math.min(
              30,
              Math.max(1, Math.round(Number(raw?.delayDays) || 3))
            ),
      purpose: String(raw?.purpose || "").trim().slice(0, 240),
      ...(contentType ? { contentType } : {}),
      guidance: String(raw?.guidance || "").trim().slice(0, 500),
      assetUrl: assetUrl || null,
    } satisfies OutreachSequenceStep;
  });
  const error = outreachSequenceValidationError(sequence);
  return { sequence: error ? [] : sequence, error };
}
