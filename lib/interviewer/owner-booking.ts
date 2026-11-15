import "server-only";

import { publicBookingUrl } from "@/lib/interviewer/booking-link";
import { supabaseService } from "@/lib/supabase";

export async function loadOwnerBookingUrl(ownerId: string, workspaceId: string): Promise<string> {
  if (!ownerId || !workspaceId) return "";
  const profile = await supabaseService
    .from("salesperson_profiles")
    .select("booking_url")
    .eq("user_id", ownerId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (profile.error) return "";
  return publicBookingUrl(profile.data?.booking_url);
}
