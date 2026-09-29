export const STAKEHOLDER_ROLE_VALUES = [
  "decision_maker",
  "champion",
  "user",
  "influencer",
  "blocker",
  "unknown",
] as const;

export const STAKEHOLDER_INFLUENCE_VALUES = ["high", "medium", "low"] as const;
export const STAKEHOLDER_ENGAGEMENT_VALUES = ["warm", "neutral", "cold"] as const;

export type StakeholderRole = (typeof STAKEHOLDER_ROLE_VALUES)[number];
export type StakeholderInfluence = (typeof STAKEHOLDER_INFLUENCE_VALUES)[number];
export type StakeholderEngagement = (typeof STAKEHOLDER_ENGAGEMENT_VALUES)[number];

export type ContactStakeholderAttributes = {
  stakeholderRole?: StakeholderRole;
  stakeholderInfluence?: StakeholderInfluence;
  stakeholderEngagement?: StakeholderEngagement;
};

const KEYS = [
  "stakeholderRole",
  "stakeholderInfluence",
  "stakeholderEngagement",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const includes = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && values.includes(value as T);

export function pickContactStakeholderAttributes(
  value: unknown
): ContactStakeholderAttributes {
  if (!isRecord(value)) return {};
  const safe: ContactStakeholderAttributes = {};
  if (includes(STAKEHOLDER_ROLE_VALUES, value.stakeholderRole)) {
    safe.stakeholderRole = value.stakeholderRole;
  }
  if (includes(STAKEHOLDER_INFLUENCE_VALUES, value.stakeholderInfluence)) {
    safe.stakeholderInfluence = value.stakeholderInfluence;
  }
  if (includes(STAKEHOLDER_ENGAGEMENT_VALUES, value.stakeholderEngagement)) {
    safe.stakeholderEngagement = value.stakeholderEngagement;
  }
  return safe;
}

export function validateContactStakeholderPatch(value: unknown):
  | { ok: true; patch: ContactStakeholderAttributes }
  | { ok: false; status: 400 | 403; error: string } {
  if (!isRecord(value)) {
    return { ok: false, status: 400, error: "Choose a valid stakeholder value" };
  }
  const keys = Object.keys(value);
  if (!keys.length) {
    return { ok: false, status: 400, error: "Choose a stakeholder value to save" };
  }
  if (keys.some((key) => !KEYS.includes(key as (typeof KEYS)[number]))) {
    return {
      ok: false,
      status: 403,
      error: "Only stakeholder role, influence and engagement are shared sales fields",
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "stakeholderRole") &&
    !includes(STAKEHOLDER_ROLE_VALUES, value.stakeholderRole)
  ) {
    return { ok: false, status: 400, error: "Choose a valid stakeholder buying role" };
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "stakeholderInfluence") &&
    !includes(STAKEHOLDER_INFLUENCE_VALUES, value.stakeholderInfluence)
  ) {
    return { ok: false, status: 400, error: "Choose a valid stakeholder influence" };
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "stakeholderEngagement") &&
    !includes(STAKEHOLDER_ENGAGEMENT_VALUES, value.stakeholderEngagement)
  ) {
    return { ok: false, status: 400, error: "Choose a valid stakeholder engagement" };
  }
  return { ok: true, patch: pickContactStakeholderAttributes(value) };
}

export function validateContactStakeholderValues(value: unknown):
  | { ok: true }
  | { ok: false; status: 400; error: string } {
  if (!isRecord(value)) {
    return { ok: false, status: 400, error: "Choose a valid stakeholder value" };
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "stakeholderRole") &&
    !includes(STAKEHOLDER_ROLE_VALUES, value.stakeholderRole)
  ) {
    return { ok: false, status: 400, error: "Choose a valid stakeholder buying role" };
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "stakeholderInfluence") &&
    !includes(STAKEHOLDER_INFLUENCE_VALUES, value.stakeholderInfluence)
  ) {
    return { ok: false, status: 400, error: "Choose a valid stakeholder influence" };
  }
  if (
    Object.prototype.hasOwnProperty.call(value, "stakeholderEngagement") &&
    !includes(STAKEHOLDER_ENGAGEMENT_VALUES, value.stakeholderEngagement)
  ) {
    return { ok: false, status: 400, error: "Choose a valid stakeholder engagement" };
  }
  return { ok: true };
}
