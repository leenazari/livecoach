import "server-only";

import { supabaseService } from "@/lib/supabase";
import type { RecordScope } from "@/lib/record-scope";
import type { SharedCalendarOccurrence } from "@/lib/shared-call-access";
import { PRECALL_LEAD_MS, PRECALL_PREFERENCE_KEY, precallPreferenceLeadMs } from "@/lib/precall-schedule";

// The caller has already verified the owned calendar occurrence. Only its
// verified attendees may influence a shared bot. Never inherit team settings
// or take account IDs/lead times from a browser's request body.
export async function getPrecallLeadMs(scope: RecordScope, occurrence: SharedCalendarOccurrence | null) {
  if (occurrence && (occurrence.requested.workspace_id !== scope.workspaceId ||
      occurrence.requested.owner_id !== scope.userId ||
      !occurrence.members.some(member => member.userId === scope.userId))) {
    throw new Error("Notetaker occurrence scope could not be verified");
  }
  const userIds = Array.from(new Set([scope.userId, ...(occurrence?.members.map(member => member.userId) || [])]));
  const { data: members, error: membershipError } = await supabaseService
    .from("workspace_members").select("user_id")
    .eq("workspace_id", scope.workspaceId).eq("status", "active").in("user_id", userIds);
  if (membershipError) throw membershipError;
  const activeIds = (members || []).map((member: { user_id: string }) => member.user_id);
  if (!activeIds.includes(scope.userId)) throw new Error("Active notetaker account required");

  const { data, error } = await supabaseService.from("app_config").select("value")
    .eq("workspace_id", scope.workspaceId).eq("visibility", "private")
    .eq("key", PRECALL_PREFERENCE_KEY).in("owner_id", activeIds);
  if (error) throw error;
  // One capture for the exact shared occurrence. Use the earliest requested
  // arrival so attendees syncing in a different order cannot move it back.
  return Math.max(PRECALL_LEAD_MS, ...(data || []).map((row: { value: string | null }) => precallPreferenceLeadMs(row.value)));
}
