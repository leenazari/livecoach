export const OUTREACH_SEQUENCE_MAX_STEPS = 6;

export const OUTREACH_SEQUENCE_CONTENT_TYPES = [
  "plain",
  "insight",
  "case_study",
  "video",
  "close_loop",
] as const;

export type OutreachSequenceContentType =
  (typeof OUTREACH_SEQUENCE_CONTENT_TYPES)[number];

export type OutreachSequenceStep = {
  step: number;
  channel?: "email";
  delayDays: number;
  purpose: string;
  contentType?: OutreachSequenceContentType;
  guidance?: string;
  assetUrl?: string | null;
};

export const OUTREACH_SEQUENCE_TEMPLATES: ReadonlyArray<{
  contentType: OutreachSequenceContentType;
  label: string;
  shortLabel: string;
  icon: string;
  purpose: string;
  guidance: string;
}> = [
  {
    contentType: "plain",
    label: "Relevant email",
    shortLabel: "Email",
    icon: "✉",
    purpose: "Open a relevant conversation with one easy question",
    guidance: "Lead with one verified reason this person should care now.",
  },
  {
    contentType: "insight",
    label: "Useful insight",
    shortLabel: "Insight",
    icon: "◆",
    purpose: "Add a useful new reason to respond",
    guidance: "Share one concise observation that helps this prospect make a better decision.",
  },
  {
    contentType: "case_study",
    label: "Proof point",
    shortLabel: "Proof",
    icon: "✓",
    purpose: "Build confidence with approved evidence",
    guidance: "Use only a verified case study or approved product proof. Never invent a result.",
  },
  {
    contentType: "video",
    label: "Video or demo",
    shortLabel: "Video",
    icon: "▶",
    purpose: "Make the value easy to see",
    guidance: "Introduce the approved video or demo link in one natural sentence.",
  },
  {
    contentType: "close_loop",
    label: "Close the loop",
    shortLabel: "Close",
    icon: "◎",
    purpose: "Close the loop without pressure",
    guidance: "Make it easy to reply yes, later, or not relevant. Do not repeat the opening pitch.",
  },
];

const DEFAULT_SEQUENCE: OutreachSequenceStep[] = [
  createOutreachSequenceStep("plain", 0),
  createOutreachSequenceStep("insight", 1),
  { ...createOutreachSequenceStep("close_loop", 2), delayDays: 7 },
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
    delayDays: index === 0 ? 0 : 3,
    purpose: template.purpose,
    contentType: template.contentType,
    guidance: template.guidance,
    assetUrl: null,
  };
}

export function defaultOutreachSequence(): OutreachSequenceStep[] {
  return DEFAULT_SEQUENCE.map((step) => ({ ...step }));
}

export function renumberOutreachSequence(
  sequence: OutreachSequenceStep[]
): OutreachSequenceStep[] {
  return sequence.map((step, index) => ({
    ...step,
    step: index + 1,
    channel: "email",
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

export function outreachSequenceValidationError(
  sequence: OutreachSequenceStep[]
): string | null {
  if (!sequence.length) return "Add at least one sequence step";
  if (sequence.length > OUTREACH_SEQUENCE_MAX_STEPS) {
    return `A campaign can have up to ${OUTREACH_SEQUENCE_MAX_STEPS} steps`;
  }
  for (let index = 0; index < sequence.length; index += 1) {
    const step = sequence[index];
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
    const contentType = OUTREACH_SEQUENCE_CONTENT_TYPES.includes(
      raw?.contentType
    )
      ? raw.contentType
      : "plain";
    return {
      step: index + 1,
      channel: "email" as const,
      delayDays:
        index === 0
          ? 0
          : Math.min(
              30,
              Math.max(1, Math.round(Number(raw?.delayDays) || 3))
            ),
      purpose: String(raw?.purpose || "").trim().slice(0, 240),
      contentType,
      guidance: String(raw?.guidance || "").trim().slice(0, 500),
      assetUrl: assetUrl || null,
    } satisfies OutreachSequenceStep;
  });
  const error = outreachSequenceValidationError(sequence);
  return { sequence: error ? [] : sequence, error };
}
