export type MicPermission = "granted" | "denied" | "prompt" | "unknown";
export type MicStartPlan = "auto" | "button" | "blocked";

export function micStartPlan(permission: MicPermission): MicStartPlan {
  if (permission === "granted") return "auto";
  if (permission === "denied") return "blocked";
  return "button";
}
