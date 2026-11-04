import "server-only";

import {
  emailReplyPolicyGuidanceEnabled,
  resolveEmailReplyPolicyGuidance,
  type PolicyLessonSource,
} from "@/lib/email-reply-policy";
import type { RecordScope } from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";

// Active members can read a lesson they do not own when it is approved and
// visibility is team. That is the "Members read approved team knowledge" RLS
// policy. supabaseAdmin uses the signed-in user's JWT, so a rep sees the
// workspace owner's published row. These filters repeat that rule for a
// service-scoped read, which bypasses RLS but still keeps team-visible rows.
async function fetchTeamApprovedLessons(scope: RecordScope): Promise<PolicyLessonSource[]> {
  const { data, error } = await supabaseAdmin
    .from("lessons")
    .select("id,title,topic,content,status,visibility,created_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("status", "approved")
    .eq("visibility", "team")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []) as PolicyLessonSource[];
}

// Empty string means the caller must draft exactly as before. The kill switch
// and any lookup failure both take that path. Nothing is sent from here.
export async function loadEmailReplyPolicyGuidance(
  scope: RecordScope,
  emailText: string
): Promise<string> {
  try {
    return await resolveEmailReplyPolicyGuidance({
      emailText,
      enabled: emailReplyPolicyGuidanceEnabled(),
      loadLessons: () => fetchTeamApprovedLessons(scope),
    });
  } catch (error) {
    console.error(
      "Email reply policy lesson lookup failed",
      error instanceof Error ? error.message : "unknown"
    );
    return "";
  }
}
