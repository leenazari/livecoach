export type BusinessProfile = {
  businessType: string;
  sells: string;
  customers: string;
  howTheyServe: string;
  pain: string;
};

export function emptyBusinessProfile(): BusinessProfile {
  return { businessType: "", sells: "", customers: "", howTheyServe: "", pain: "" };
}

export function profileKnown(profile: BusinessProfile): boolean {
  return Boolean(profile.businessType.trim());
}

export function noteBusiness(text: string, profile: BusinessProfile): BusinessProfile {
  const next = { ...profile };
  const type = text.match(/\b(?:we(?:'re| are)|i(?:'m| am)|it(?:'s| is)|we run|i run)\s+(?:a|an)\s+([^.,!?]{2,80})/i);
  if (!next.businessType && type) next.businessType = type[1].trim();
  const sells = text.match(/\b(?:we sell|we offer|we provide)\s+([^.,!?]{2,80})/i);
  if (sells) next.sells = sells[1].trim();
  const customers = text.match(/\b(?:our (?:customers|clients|patients|guests) (?:are|include)|we serve)\s+([^.,!?]{2,80})/i);
  if (customers) next.customers = customers[1].trim();
  const pain = text.match(/\b(?:the (?:problem|challenge|issue) is|we struggle with|struggling with)\s+([^.,!?]{2,120})/i);
  if (pain) next.pain = pain[1].trim();
  return next;
}

export function businessProfileNote(profile: BusinessProfile): string {
  if (!profileKnown(profile)) {
    return "Note for you only. Do not read this note aloud. You do not yet know what their business is. Ask one short question about the business before the first feature slide. Do not describe a feature until they answer.";
  }
  const line = (label: string, value: string) => (value.trim() ? `${label}: ${value.trim()}.` : "");
  return [
    "Note for you only. Do not read this note aloud. Lead business profile, use it for the whole demo.",
    line("Business type", profile.businessType),
    line("What they sell", profile.sells),
    line("Who their customers are", profile.customers),
    line("How they serve them", profile.howTheyServe),
    line("Pain points", profile.pain),
    "Never describe a feature without tying it to this business with a specific scenario. For example, for a dental practice, a patient asking about prices at 10pm gets answered and booked. Use their words. Do not invent a detail that is not in this profile.",
  ].filter(Boolean).join(" ");
}
