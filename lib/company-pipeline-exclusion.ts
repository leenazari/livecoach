export type CompanyPipelineExclusion = {
  active: true;
  reason: string;
  sourceType: "human" | "system";
  sourceChannel: string;
  updatedAt: string;
  actorUserId?: string | null;
};

const objectValue = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export function activeCompanyPipelineExclusion(
  profile: unknown
): CompanyPipelineExclusion | null {
  const value = objectValue(profile).pipeline_exclusion;
  if (!value || typeof value !== "object" || value.active !== true) return null;
  return {
    active: true,
    reason:
      typeof value.reason === "string" && value.reason.trim()
        ? value.reason.trim()
        : "This company was explicitly removed from the sales pipeline",
    sourceType: value.sourceType === "system" ? "system" : "human",
    sourceChannel:
      typeof value.sourceChannel === "string" && value.sourceChannel.trim()
        ? value.sourceChannel.trim()
        : "client_relationship_update",
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.trim()
        ? value.updatedAt.trim()
        : new Date(0).toISOString(),
    actorUserId:
      typeof value.actorUserId === "string" ? value.actorUserId : null,
  };
}

export function withCompanyPipelineExclusion(
  profile: unknown,
  exclusion: Omit<CompanyPipelineExclusion, "active">
): Record<string, any> {
  return {
    ...objectValue(profile),
    pipeline_exclusion: {
      active: true,
      ...exclusion,
    },
  };
}

export function companyPipelineExclusionIds(
  companies: Iterable<{ id: string; profile?: unknown }>
): Set<string> {
  const ids = new Set<string>();
  for (const company of companies) {
    if (company?.id && activeCompanyPipelineExclusion(company.profile)) {
      ids.add(company.id);
    }
  }
  return ids;
}
