import "server-only";

import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";

// A provider's `self` flag covers only that calendar address, not the same
// person's CRM login or other mailbox. Read exact account addresses, never
// infer identity from a display name or treat all Gmail users as internal.
// These addresses are exclusion hints, not an authorisation mechanism.
export async function loadOwnAccountEmails(ownerId?: string): Promise<Set<string>> {
  const scope = await resolveRecordScope(ownerId);
  const { data: member, error: memberError } = await supabaseService
    .from("workspace_members")
    .select("status")
    .eq("workspace_id", scope.workspaceId)
    .eq("user_id", scope.userId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (member?.status !== "active") throw new Error("This account is not active");

  const results = await Promise.all([
    supabaseService.from("profiles").select("email,outreach_sender_email")
      .eq("user_id", scope.userId).maybeSingle(),
    supabaseService.from("google_oauth").select("email")
      .eq("owner_id", scope.userId).eq("workspace_id", scope.workspaceId).maybeSingle(),
    supabaseService.from("microsoft_oauth").select("email")
      .eq("owner_id", scope.userId).eq("workspace_id", scope.workspaceId).maybeSingle(),
  ]);
  const emails = new Set<string>();
  for (const { data, error } of results) {
    if (error) throw error; // No guessed lead if account identity could not be read.
    for (const value of [data?.email, (data as any)?.outreach_sender_email]) {
      const email = String(value || "").trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) emails.add(email);
    }
  }
  return emails;
}
