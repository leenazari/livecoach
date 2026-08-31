import "server-only";

import { getSalesProfile } from "@/lib/sales-profile";

type SalespersonScope = {
  userId: string;
  workspaceId: string;
};

// Outreach has one booking-link source of truth. Campaign and global links are
// deliberately excluded so a teammate can never send another person's calendar.
export async function getPersonalOutreachBookingLink(
  scope: SalespersonScope
): Promise<string> {
  const profile = await getSalesProfile(scope);
  return String(profile.bookingUrl || "").trim();
}

export function shouldIncludePersonalOutreachBookingLink(input: {
  bookingUrl: string;
  mode: string | null | undefined;
  step: number;
  lastStep: number;
}): boolean {
  if (!input.bookingUrl) return false;
  if (input.mode === "always") return true;
  return input.mode === "final_step" && input.step >= input.lastStep;
}
