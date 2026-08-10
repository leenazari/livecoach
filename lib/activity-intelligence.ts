export type ActivityChannel = "phone" | "text" | "voice" | "note";

export type ActivityNextAction = {
  text: string;
  action: "email" | "call" | "task";
  owner: "us" | "buyer" | "joint";
  dueAt: string | null;
};

export type ActivityStakeholderUpdate = {
  person: string;
  buyingRole:
    | "decision_maker"
    | "champion"
    | "influencer"
    | "user"
    | "blocker";
  evidence: string;
};

export type ActivityIntelligence = {
  contextId: string;
  createdAt: string;
  channel: ActivityChannel;
  status: "pending" | "applied";
  overview: string;
  buyingSignals: string[];
  risks: string[];
  stakeholderUpdates: ActivityStakeholderUpdate[];
  relationshipStage: "Product Trial" | "Partner" | "Customer" | "In House" | null;
  nextAction: ActivityNextAction | null;
  nextCallIntent: string | null;
  followUp: { subject: string; body: string } | null;
  appliedAt?: string | null;
  applied?: string[];
  warnings?: string[];
};

const cleanText = (value: any, max: number): string => {
  const text = String(value || "")
    .replace(/[—–]/g, ", ")
    .replace(/;/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
  return text.slice(0, max);
};

const cleanList = (value: any, maxItems: number, maxChars: number): string[] =>
  (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string")
    .map((item) => cleanText(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);

const cleanDate = (value: any): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
};

const ROLES = new Set([
  "decision_maker",
  "champion",
  "influencer",
  "user",
  "blocker",
]);
const ACTIONS = new Set(["email", "call", "task"]);
const OWNERS = new Set(["us", "buyer", "joint"]);
const RELATIONSHIP_STAGES = new Set([
  "Product Trial",
  "Partner",
  "Customer",
  "In House",
]);

// Model output is treated as untrusted input. Keep only the small, typed set of
// fields the approval endpoint knows how to apply.
export function cleanActivityIntelligence(
  value: any,
  meta: {
    contextId: string;
    createdAt: string;
    channel: ActivityChannel;
  }
): ActivityIntelligence {
  const nextText = cleanText(value?.nextAction?.text, 300);
  const nextAction = nextText
    ? {
        text: nextText,
        action: ACTIONS.has(value?.nextAction?.action)
          ? value.nextAction.action
          : "task",
        owner: OWNERS.has(value?.nextAction?.owner)
          ? value.nextAction.owner
          : "us",
        dueAt: cleanDate(value?.nextAction?.dueAt),
      }
    : null;

  const stakeholderUpdates = (Array.isArray(value?.stakeholderUpdates)
    ? value.stakeholderUpdates
    : [])
    .map((item: any) => ({
      person: cleanText(item?.person, 120),
      buyingRole: ROLES.has(item?.buyingRole) ? item.buyingRole : "",
      evidence: cleanText(item?.evidence, 220),
    }))
    .filter((item: any) => item.person && item.buyingRole && item.evidence)
    .slice(0, 3) as ActivityStakeholderUpdate[];

  const subject = cleanText(value?.followUp?.subject, 180);
  const body = cleanText(value?.followUp?.body, 1400);

  return {
    ...meta,
    status: "pending",
    overview: cleanText(value?.overview, 320),
    buyingSignals: cleanList(value?.buyingSignals, 3, 220),
    risks: cleanList(value?.risks, 3, 220),
    stakeholderUpdates,
    relationshipStage: RELATIONSHIP_STAGES.has(value?.relationshipStage)
      ? value.relationshipStage
      : null,
    nextAction,
    nextCallIntent: cleanText(value?.nextCallIntent, 600) || null,
    followUp: subject || body ? { subject: subject || "Follow-up", body } : null,
  };
}

export function activityHasActions(value: ActivityIntelligence | null): boolean {
  return !!(
    value &&
    (value.nextAction ||
      value.nextCallIntent ||
      value.relationshipStage ||
      value.followUp?.body ||
      value.stakeholderUpdates.length)
  );
}
