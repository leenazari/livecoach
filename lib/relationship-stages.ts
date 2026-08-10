// One shared list keeps every CRM surface — client portfolio, opportunity
// board, client details and Brain-approved actions — on the same vocabulary.
export const RELATIONSHIP_STAGE_OPTIONS = [
  "New",
  "Discovery",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Partner",
  "Customer",
  "Product Trial",
  "In House",
  "Dormant",
] as const;

export const RELATIONSHIP_STAGE_BY_KEY = new Map(
  RELATIONSHIP_STAGE_OPTIONS.map((stage) => [stage.toLowerCase(), stage])
);

export const isRelationshipStageOption = (stage: string) =>
  RELATIONSHIP_STAGE_OPTIONS.some((option) => option === stage);

export const isInHouseRelationship = (stage: string | null | undefined) =>
  String(stage || "").trim().toLowerCase() === "in house";

export const isNonCommercialRelationship = (
  stage: string | null | undefined
) => {
  const value = String(stage || "").trim().toLowerCase();
  return value === "in house" || value === "product trial";
};
