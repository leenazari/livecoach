import "server-only";

import { getRequestScope } from "@/lib/request-scope";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";

export type OutreachIdentity = {
  userId: string;
  workspaceId: string;
  senderName: string;
  senderEmail: string;
  provider: "google" | "microsoft";
  mailboxEmail: string;
  // Kept while older call sites migrate to the provider-neutral name.
  googleEmail: string;
};

export async function resolveOutreachIdentity(
  explicitUserId?: string
): Promise<OutreachIdentity> {
  const scope = await resolveRecordScope(explicitUserId);
  const requestScope = getRequestScope();
  if (requestScope && scope.userId !== requestScope.userId) {
    throw new Error("Another account's outreach identity is not available");
  }
  const [
    { data: member, error: memberError },
    { data: profile, error: profileError },
    { data: google, error: googleError },
    { data: microsoft, error: microsoftError },
  ] =
    await Promise.all([
      supabaseService
        .from("workspace_members")
        .select("status")
        .eq("workspace_id", scope.workspaceId)
        .eq("user_id", scope.userId)
        .maybeSingle(),
      supabaseService
        .from("profiles")
        .select("display_name,outreach_sender_name,outreach_sender_email")
        .eq("user_id", scope.userId)
        .maybeSingle(),
      supabaseService
        .from("google_oauth")
        .select("email,refresh_token")
        .eq("owner_id", scope.userId)
        .maybeSingle(),
      supabaseService
        .from("microsoft_oauth")
        .select("email,refresh_token")
        .eq("owner_id", scope.userId)
        .maybeSingle(),
    ]);
  if (memberError) throw memberError;
  if (profileError) throw profileError;
  if (googleError) throw googleError;
  if (microsoftError) throw microsoftError;
  if (!member || member.status !== "active")
    throw new Error("This account is not active");
  const provider = google?.refresh_token && google.email
    ? "google"
    : microsoft?.refresh_token && microsoft.email
      ? "microsoft"
      : null;
  const mailboxEmail = String(google?.email || microsoft?.email || "")
    .trim()
    .toLowerCase();
  if (!provider || !mailboxEmail)
    throw new Error("Connect this account's Google or Microsoft email first");
  const senderEmail = String(profile?.outreach_sender_email || mailboxEmail)
    .trim()
    .toLowerCase();
  const senderName = String(
    profile?.outreach_sender_name || profile?.display_name || mailboxEmail
  ).trim();
  if (!senderEmail || !senderName)
    throw new Error("This account needs an outreach sender identity");
  return {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    senderName,
    senderEmail,
    provider,
    mailboxEmail,
    googleEmail: mailboxEmail,
  };
}
