import "server-only";

import { senderAfterConnectorDisconnect } from "@/lib/connector-disconnect-policy";
import type { RequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export async function reconcileSenderAfterConnectorDisconnect(
  scope: RequestScope,
  disconnectedEmail: string | null
): Promise<{ provider: "google" | "microsoft" | null; senderEmail: string | null }> {
  const [profileResult, googleResult, microsoftResult] = await Promise.all([
    supabaseService
      .from("profiles")
      .select("outreach_sender_email")
      .eq("user_id", scope.userId)
      .maybeSingle(),
    supabaseService
      .from("google_oauth")
      .select("email,refresh_token")
      .eq("owner_id", scope.userId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle(),
    supabaseService
      .from("microsoft_oauth")
      .select("email,refresh_token")
      .eq("owner_id", scope.userId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (googleResult.error) throw googleResult.error;
  if (microsoftResult.error) throw microsoftResult.error;

  const next = senderAfterConnectorDisconnect({
    currentSenderEmail: profileResult.data?.outreach_sender_email,
    disconnectedEmail,
    googleEmail: googleResult.data?.refresh_token ? googleResult.data.email : null,
    microsoftEmail: microsoftResult.data?.refresh_token
      ? microsoftResult.data.email
      : null,
  });
  const current = String(profileResult.data?.outreach_sender_email || "")
    .trim()
    .toLowerCase() || null;
  if (next.senderEmail !== current) {
    const { data, error } = await supabaseService
      .from("profiles")
      .update({
        outreach_sender_email: next.senderEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", scope.userId)
      .select("user_id,outreach_sender_email")
      .maybeSingle();
    if (error) throw error;
    if (!data || data.outreach_sender_email !== next.senderEmail)
      throw new Error("The outreach sender was not reconciled");
  }
  return next;
}
