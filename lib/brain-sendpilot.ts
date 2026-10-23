import "server-only";
import { supabaseService } from "@/lib/supabase";
import { isUuid } from "@/lib/uuid";

// A visible/assigned CRM prospect is not necessarily a lead in this member's
// connected provider account. Check both before offering an external action.
export async function loadBrainSendPilotStopTargets(
  scope: { userId: string; workspaceId: string },
  prospectIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(prospectIds.filter(isUuid))].slice(0, 50);
  if (!ids.length) return new Set();
  const { data: integration, error: integrationError } = await supabaseService
    .from("sendpilot_integrations")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("status", "active")
    .maybeSingle();
  if (integrationError) throw integrationError;
  if (!integration) return new Set();
  const { data: prospects, error: prospectError } = await supabaseService
    .from("outreach_prospects")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .eq("assigned_to_user_id", scope.userId)
    .in("id", ids);
  if (prospectError) throw prospectError;
  const assignedIds = (prospects || []).map((row: any) => row.id);
  if (!assignedIds.length) return new Set();
  const { data: links, error: linkError } = await supabaseService
    .from("sendpilot_lead_links")
    .select("outreach_prospect_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("integration_id", integration.id)
    .in("outreach_prospect_id", assignedIds)
    .not("sendpilot_lead_id", "is", null);
  if (linkError) throw linkError;
  return new Set((links || []).map((row: any) => row.outreach_prospect_id));
}
